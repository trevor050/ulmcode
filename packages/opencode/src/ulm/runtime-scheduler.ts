import fs from "fs/promises"
import path from "path"
import type { BackgroundJob } from "@/background/job"
import { operationPath, slug } from "./artifact"
import { evaluateRuntimeGovernor, type GovernorDecision } from "./runtime-governor"
import { runOperationStep, type OperationRunResult } from "./operation-run"
import { nextWorkUnits, requeueStaleWorkUnits, type WorkQueueNextResult } from "./work-queue"

type SchedulerLaunchParams = NonNullable<OperationRunResult["taskParams"]>
type SchedulerCommandParams = WorkQueueNextResult["units"][number]["commandSupervise"]

export type RuntimeSchedulerInput = {
  operationID: string
  maxCycles?: number
  leaseSeconds?: number
  backgroundJobs?: BackgroundJob.Info[]
  launchModelLane?: (params: SchedulerLaunchParams) => Promise<{ jobID?: string | undefined } | undefined>
  launchCommandWorkUnit?: (params: SchedulerCommandParams) => Promise<{ jobID?: string | undefined } | undefined>
  commandWorkUnitLimit?: number
  now?: Date
}

export type RuntimeSchedulerCycle = {
  cycle: number
  time: string
  run: OperationRunResult
  governor: GovernorDecision
  requeuedWorkUnits: string[]
  launchedJobs: string[]
  launchedCommandJobs: string[]
}

export type RuntimeSchedulerResult = {
  operationID: string
  heartbeatPath: string
  logPath: string
  cycles: RuntimeSchedulerCycle[]
  stopped: boolean
  reason: string
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function appendJsonl(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(value) + "\n")
}

export async function runRuntimeScheduler(worktree: string, input: RuntimeSchedulerInput): Promise<RuntimeSchedulerResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const schedulerDir = path.join(root, "scheduler")
  const heartbeatPath = path.join(schedulerDir, "heartbeat.json")
  const logPath = path.join(schedulerDir, "scheduler.jsonl")
  const maxCycles = Math.max(1, input.maxCycles ?? 1)
  const cycles: RuntimeSchedulerCycle[] = []
  let stopped = false
  let reason = "max scheduler cycles reached"

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const now = input.now ?? new Date()
    const lease = await requeueStaleWorkUnits(worktree, {
      operationID,
      leaseSeconds: input.leaseSeconds,
      now,
    })
    const run = await runOperationStep(worktree, {
      operationID,
      backgroundJobs: input.backgroundJobs,
    })
    const launched = run.taskParams && input.launchModelLane ? await input.launchModelLane(run.taskParams) : undefined
    const launchedJobs = launched?.jobID ? [launched.jobID] : []
    const commandUnits = input.launchCommandWorkUnit
      ? await nextWorkUnits(worktree, {
          operationID,
          limit: input.commandWorkUnitLimit ?? 2,
          claim: true,
        }).catch((error) => {
          if ((error as Error).message.includes("work queue is missing")) {
            return { units: [] } as Pick<WorkQueueNextResult, "units">
          }
          throw error
        })
      : { units: [] }
    const launchedCommandJobs: string[] = []
    for (const unit of commandUnits.units) {
      const launchedCommand = await input.launchCommandWorkUnit?.({ ...unit.commandSupervise, dryRun: false })
      if (launchedCommand?.jobID) launchedCommandJobs.push(launchedCommand.jobID)
    }
    const governor = await evaluateRuntimeGovernor(worktree, { operationID, laneID: run.laneID })
    const record: RuntimeSchedulerCycle = {
      cycle,
      time: now.toISOString(),
      run,
      governor,
      requeuedWorkUnits: lease.requeuedUnits,
      launchedJobs,
      launchedCommandJobs,
    }
    cycles.push(record)
    await appendJsonl(logPath, record)
    await writeJson(heartbeatPath, {
      operationID,
      cycle,
      time: record.time,
      lastAction: run.action,
      lastReason: run.reason,
      governorAction: governor.action,
      governorReason: governor.reason,
      requeuedWorkUnits: lease.requeuedUnits,
      launchedJobs,
      launchedCommandJobs,
      stopped: false,
    })

    if (run.action === "stop" || governor.action === "stop") {
      stopped = true
      reason = governor.action === "stop" ? governor.reason : run.reason
      break
    }
    if (run.action === "wait" || run.action === "compact" || run.action === "schedule") {
      reason = run.reason
      break
    }
  }

  await writeJson(heartbeatPath, {
    operationID,
    cycles: cycles.length,
    time: new Date().toISOString(),
    lastAction: cycles.at(-1)?.run.action,
    lastReason: cycles.at(-1)?.run.reason,
    governorAction: cycles.at(-1)?.governor.action,
    governorReason: cycles.at(-1)?.governor.reason,
    launchedJobs: cycles.at(-1)?.launchedJobs ?? [],
    launchedCommandJobs: cycles.at(-1)?.launchedCommandJobs ?? [],
    stopped,
    reason,
  })
  return { operationID, heartbeatPath, logPath, cycles, stopped, reason }
}

export function formatRuntimeScheduler(result: RuntimeSchedulerResult) {
  return [
    `# Runtime Scheduler: ${result.operationID}`,
    "",
    `- cycles: ${result.cycles.length}`,
    `- stopped: ${result.stopped}`,
    `- reason: ${result.reason}`,
    `- heartbeat: ${result.heartbeatPath}`,
    `- log: ${result.logPath}`,
    "",
    "## Cycles",
    "",
    ...result.cycles.map(
      (cycle) =>
        `- ${cycle.cycle}: run=${cycle.run.action} governor=${cycle.governor.action} requeued=${cycle.requeuedWorkUnits.length} launched=${cycle.launchedJobs.length} command_jobs=${cycle.launchedCommandJobs.length}`,
    ),
    "",
    "<runtime_scheduler_json>",
    JSON.stringify(result, null, 2),
    "</runtime_scheduler_json>",
  ].join("\n")
}
