import fs from "fs/promises"
import path from "path"
import type { BackgroundJob } from "@/background/job"
import { operationPath, slug } from "./artifact"
import { runRuntimeScheduler, type RuntimeSchedulerCycle } from "./runtime-scheduler"
import type { OperationRunResult } from "./operation-run"
import { markRecoveredLanesRunning, restartableOperationJobs } from "./operation-recovery"

export type RuntimeDaemonInput = {
  operationID: string
  maxRuntimeSeconds?: number
  cycleIntervalSeconds?: number
  maxCycles?: number
  schedulerCyclesPerTick?: number
  leaseSeconds?: number
  errorBackoffSeconds?: number
  maxConsecutiveErrors?: number
  staleLockSeconds?: number
  backgroundJobs?: BackgroundJob.Info[]
  backgroundJobProvider?: () => Promise<BackgroundJob.Info[]>
  launchModelLane?: (params: NonNullable<OperationRunResult["taskParams"]>) => Promise<{ jobID?: string | undefined } | undefined>
  launchCommandWorkUnit?: Parameters<typeof runRuntimeScheduler>[1]["launchCommandWorkUnit"]
  commandWorkUnitLimit?: number
  recoverBackgroundJob?: (job: BackgroundJob.Info) => Promise<{ jobID?: string | undefined } | undefined>
  maxRecoveriesPerTick?: number
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  signal?: AbortSignal
}

export type RuntimeDaemonResult = {
  operationID: string
  lockPath: string
  heartbeatPath: string
  logPath: string
  cycles: RuntimeSchedulerCycle[]
  startedAt: string
  endedAt: string
  elapsedSeconds: number
  stopped: boolean
  reason: string
  recoveredJobs: string[]
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function appendJsonl(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(value) + "\n")
}

async function lockIsStale(lockPath: string, staleLockSeconds: number, now: Date) {
  const lock = await readJson<{ updatedAt?: string; pid?: number }>(lockPath)
  if (!lock?.updatedAt) return true
  const updatedAt = Date.parse(lock.updatedAt)
  if (!Number.isFinite(updatedAt)) return true
  if ((now.getTime() - updatedAt) / 1000 > staleLockSeconds) return true
  if (lock.pid && lock.pid !== process.pid) {
    try {
      process.kill(lock.pid, 0)
      return false
    } catch {
      return true
    }
  }
  return false
}

async function acquireLock(lockPath: string, staleLockSeconds: number, now: Date) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true })
  const content = JSON.stringify({ pid: process.pid, createdAt: now.toISOString(), updatedAt: now.toISOString() }, null, 2) + "\n"
  try {
    const handle = await fs.open(lockPath, "wx")
    await handle.writeFile(content)
    await handle.close()
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    if (!(await lockIsStale(lockPath, staleLockSeconds, now))) {
      throw new Error(`runtime daemon lock is active: ${lockPath}`, { cause: error })
    }
    await fs.rm(lockPath, { force: true })
    const handle = await fs.open(lockPath, "wx")
    await handle.writeFile(content)
    await handle.close()
  }
}

async function releaseLock(lockPath: string) {
  const lock = await readJson<{ pid?: number }>(lockPath)
  if (!lock || lock.pid === process.pid) await fs.rm(lockPath, { force: true })
}

export async function runRuntimeDaemon(worktree: string, input: RuntimeDaemonInput): Promise<RuntimeDaemonResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const daemonDir = path.join(root, "scheduler")
  const lockPath = path.join(daemonDir, "daemon.lock.json")
  const heartbeatPath = path.join(daemonDir, "daemon-heartbeat.json")
  const logPath = path.join(daemonDir, "daemon.jsonl")
  const now = input.now ?? (() => new Date())
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const maxRuntimeSeconds = Math.max(1, input.maxRuntimeSeconds ?? 20 * 60 * 60)
  const cycleIntervalSeconds = Math.max(0, input.cycleIntervalSeconds ?? 60)
  const schedulerCyclesPerTick = Math.max(1, input.schedulerCyclesPerTick ?? 1)
  const errorBackoffSeconds = Math.max(0, input.errorBackoffSeconds ?? 30)
  const maxConsecutiveErrors = Math.max(1, input.maxConsecutiveErrors ?? 3)
  const staleLockSeconds = Math.max(1, input.staleLockSeconds ?? 15 * 60)
  const maxCycles = input.maxCycles === undefined ? Number.POSITIVE_INFINITY : Math.max(1, input.maxCycles)
  const maxRecoveriesPerTick = input.maxRecoveriesPerTick === undefined ? Number.POSITIVE_INFINITY : Math.max(0, input.maxRecoveriesPerTick)
  const started = now()
  const cycles: RuntimeSchedulerCycle[] = []
  const recoveredJobs: string[] = []
  let stopped = false
  let reason = "runtime window elapsed"
  let consecutiveErrors = 0

  await acquireLock(lockPath, staleLockSeconds, started)
  try {
    for (let tick = 1; tick <= maxCycles; tick++) {
      const tickTime = now()
      const elapsedSeconds = (tickTime.getTime() - started.getTime()) / 1000
      if (input.signal?.aborted) {
        stopped = true
        reason = "signal"
        break
      }
      if (elapsedSeconds >= maxRuntimeSeconds) {
        reason = "runtime window elapsed"
        break
      }

      const backgroundJobs = input.backgroundJobProvider ? await input.backgroundJobProvider() : input.backgroundJobs
      const recoveredThisTick: string[] = []
      if (input.recoverBackgroundJob && backgroundJobs?.length) {
        const restartable = restartableOperationJobs({ operationID, jobs: backgroundJobs, maxJobs: maxRecoveriesPerTick })
        for (const job of restartable) {
          const recovered = await input.recoverBackgroundJob(job)
          recoveredThisTick.push(recovered?.jobID ?? job.id)
        }
        if (restartable.length) {
          recoveredJobs.push(...recoveredThisTick)
          await markRecoveredLanesRunning(worktree, { operationID, jobs: restartable })
        }
      }

      const scheduler = await runRuntimeScheduler(worktree, {
        operationID,
        maxCycles: schedulerCyclesPerTick,
        leaseSeconds: input.leaseSeconds,
        backgroundJobs,
        launchModelLane: input.launchModelLane,
        launchCommandWorkUnit: input.launchCommandWorkUnit,
        commandWorkUnitLimit: input.commandWorkUnitLimit,
        now: tickTime,
      }).catch(async (error) => {
        consecutiveErrors += 1
        reason = error instanceof Error ? error.message : String(error)
        const heartbeat = {
          operationID,
          pid: process.pid,
          tick,
          schedulerCycles: 0,
          totalCycles: cycles.length,
          startedAt: started.toISOString(),
          updatedAt: tickTime.toISOString(),
          elapsedSeconds,
          stopped: consecutiveErrors >= maxConsecutiveErrors,
          reason: `scheduler error: ${reason}`,
          consecutiveErrors,
          lockPath,
          recoveredJobs: recoveredThisTick,
        }
        await writeJson(lockPath, { pid: process.pid, createdAt: started.toISOString(), updatedAt: tickTime.toISOString() })
        await writeJson(heartbeatPath, heartbeat)
        await appendJsonl(logPath, heartbeat)
        if (consecutiveErrors >= maxConsecutiveErrors) {
          stopped = true
          reason = `scheduler error: ${reason}`
          return undefined
        }
        if (errorBackoffSeconds > 0) await sleep(errorBackoffSeconds * 1000)
        return undefined
      })
      if (!scheduler) {
        if (stopped) break
        continue
      }
      consecutiveErrors = 0
      cycles.push(...scheduler.cycles)
      stopped = scheduler.stopped
      reason = scheduler.reason
      const heartbeat = {
        operationID,
        pid: process.pid,
        tick,
        schedulerCycles: scheduler.cycles.length,
        totalCycles: cycles.length,
        startedAt: started.toISOString(),
        updatedAt: tickTime.toISOString(),
        elapsedSeconds,
        stopped,
        reason,
        lockPath,
        recoveredJobs: recoveredThisTick,
      }
      await writeJson(lockPath, { pid: process.pid, createdAt: started.toISOString(), updatedAt: tickTime.toISOString() })
      await writeJson(heartbeatPath, heartbeat)
      await appendJsonl(logPath, heartbeat)
      if (stopped) break
      if (scheduler.cycles.at(-1)?.governor.action === "compact") break
      if (tick < maxCycles && cycleIntervalSeconds > 0) await sleep(cycleIntervalSeconds * 1000)
    }
  } finally {
    await releaseLock(lockPath)
  }

  const ended = now()
  const elapsedSeconds = Math.max(0, (ended.getTime() - started.getTime()) / 1000)
  const result: RuntimeDaemonResult = {
    operationID,
    lockPath,
    heartbeatPath,
    logPath,
    cycles,
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    elapsedSeconds,
    stopped,
    reason,
    recoveredJobs,
  }
  await writeJson(heartbeatPath, result)
  return result
}

export function formatRuntimeDaemon(result: RuntimeDaemonResult) {
  return [
    `# Runtime Daemon: ${result.operationID}`,
    "",
    `- cycles: ${result.cycles.length}`,
    `- stopped: ${result.stopped}`,
    `- reason: ${result.reason}`,
    `- elapsed_seconds: ${result.elapsedSeconds}`,
    `- recovered_jobs: ${result.recoveredJobs.length}`,
    `- heartbeat: ${result.heartbeatPath}`,
    `- log: ${result.logPath}`,
    "",
    "<runtime_daemon_json>",
    JSON.stringify(result, null, 2),
    "</runtime_daemon_json>",
  ].join("\n")
}
