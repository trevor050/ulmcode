import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"

export type BurnInAuditStatus = "passed" | "incomplete" | "failed"

export type BurnInHarnessInput = {
  operationID: string
  targetElapsedSeconds: number
  tickSeconds?: number
  maxTicks?: number
  reset?: boolean
  now?: () => Date
}

export type BurnInCheckpoint = {
  operationID: string
  targetElapsedSeconds: number
  tickSeconds: number
  ticks: number
  daemonHeartbeats: number
  schedulerHeartbeats: number
  simulatedElapsedSeconds: number
  restartCount: number
  startedAt: string
  updatedAt: string
  completed: boolean
}

export type BurnInProof = {
  operationID: string
  elapsedTargetSeconds: number
  simulatedElapsedSeconds: number
  ticks: number
  daemonHeartbeats: number
  schedulerHeartbeats: number
  restartCount: number
  auditStatus: BurnInAuditStatus
  resumedFromCheckpoint: boolean
  startedAt: string
  endedAt: string
  heartbeatPaths: {
    daemon: string
    scheduler: string
  }
  checkpointPath: string
}

export type BurnInHarnessResult = {
  operationID: string
  root: string
  checkpointPath: string
  daemonHeartbeatPath: string
  schedulerHeartbeatPath: string
  logPath: string
  auditPath: string
  proofPath: string
  checkpoint: BurnInCheckpoint
  proof: BurnInProof
  audit: {
    status: BurnInAuditStatus
    gaps: string[]
  }
}

type BurnInHeartbeat = {
  kind: "daemon" | "scheduler"
  operationID: string
  tick: number
  simulatedElapsedSeconds: number
  targetElapsedSeconds: number
  time: string
  resumedFromCheckpoint: boolean
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

function positiveSeconds(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return Math.floor(value)
}

function auditBurnIn(checkpoint: BurnInCheckpoint): { status: BurnInAuditStatus; gaps: string[] } {
  const gaps: string[] = []
  if (checkpoint.simulatedElapsedSeconds < checkpoint.targetElapsedSeconds)
    gaps.push("target elapsed seconds not reached")
  if (checkpoint.daemonHeartbeats !== checkpoint.ticks) gaps.push("daemon heartbeat count does not match ticks")
  if (checkpoint.schedulerHeartbeats !== checkpoint.ticks) gaps.push("scheduler heartbeat count does not match ticks")
  if (!checkpoint.completed) gaps.push("checkpoint is not complete")
  return { status: gaps.length === 0 ? "passed" : "incomplete", gaps }
}

function virtualTime(startedAt: string, elapsedSeconds: number) {
  return new Date(Date.parse(startedAt) + elapsedSeconds * 1000).toISOString()
}

function formatAudit(result: BurnInHarnessResult) {
  return [
    `# ULM Accelerated Burn-In: ${result.operationID}`,
    "",
    `- audit_status: ${result.audit.status}`,
    `- elapsed_target_seconds: ${result.proof.elapsedTargetSeconds}`,
    `- simulated_elapsed_seconds: ${result.proof.simulatedElapsedSeconds}`,
    `- ticks: ${result.proof.ticks}`,
    `- daemon_heartbeats: ${result.proof.daemonHeartbeats}`,
    `- scheduler_heartbeats: ${result.proof.schedulerHeartbeats}`,
    `- restart_count: ${result.proof.restartCount}`,
    `- resumed_from_checkpoint: ${result.proof.resumedFromCheckpoint}`,
    `- proof: ${result.proofPath}`,
    result.audit.gaps.length ? `- gaps: ${result.audit.gaps.join("; ")}` : "- gaps: none",
    "",
  ].join("\n")
}

export async function runBurnInHarness(worktree: string, input: BurnInHarnessInput): Promise<BurnInHarnessResult> {
  const operationID = slug(input.operationID, "operation")
  const targetElapsedSeconds = positiveSeconds("targetElapsedSeconds", input.targetElapsedSeconds)
  const tickSeconds = positiveSeconds("tickSeconds", input.tickSeconds ?? 15 * 60)
  const maxTicks = input.maxTicks === undefined ? Number.POSITIVE_INFINITY : positiveSeconds("maxTicks", input.maxTicks)
  const now = input.now ?? (() => new Date())
  const root = path.join(operationPath(worktree, operationID), "burnin")
  const checkpointPath = path.join(root, "burnin-checkpoint.json")
  const daemonHeartbeatPath = path.join(root, "daemon-heartbeat.json")
  const schedulerHeartbeatPath = path.join(root, "scheduler-heartbeat.json")
  const logPath = path.join(root, "burnin-heartbeats.jsonl")
  const auditPath = path.join(root, "burnin-audit.md")
  const proofPath = path.join(root, "burnin-proof.json")

  if (input.reset) await fs.rm(root, { recursive: true, force: true })

  const existing = await readJson<BurnInCheckpoint>(checkpointPath)
  const resumedFromCheckpoint = !!existing && !existing.completed
  const startedAt = existing?.startedAt ?? now().toISOString()
  let checkpoint: BurnInCheckpoint = existing
    ? {
        ...existing,
        targetElapsedSeconds,
        tickSeconds,
        restartCount: existing.completed ? existing.restartCount : existing.restartCount + 1,
        completed: existing.simulatedElapsedSeconds >= targetElapsedSeconds,
      }
    : {
        operationID,
        targetElapsedSeconds,
        tickSeconds,
        ticks: 0,
        daemonHeartbeats: 0,
        schedulerHeartbeats: 0,
        simulatedElapsedSeconds: 0,
        restartCount: 0,
        startedAt,
        updatedAt: startedAt,
        completed: false,
      }

  for (let runTick = 0; runTick < maxTicks && checkpoint.simulatedElapsedSeconds < targetElapsedSeconds; runTick++) {
    const remaining = targetElapsedSeconds - checkpoint.simulatedElapsedSeconds
    const advancedSeconds = Math.min(tickSeconds, remaining)
    checkpoint = {
      ...checkpoint,
      ticks: checkpoint.ticks + 1,
      daemonHeartbeats: checkpoint.daemonHeartbeats + 1,
      schedulerHeartbeats: checkpoint.schedulerHeartbeats + 1,
      simulatedElapsedSeconds: checkpoint.simulatedElapsedSeconds + advancedSeconds,
      updatedAt: virtualTime(startedAt, checkpoint.simulatedElapsedSeconds + advancedSeconds),
      completed: checkpoint.simulatedElapsedSeconds + advancedSeconds >= targetElapsedSeconds,
    }

    const heartbeatBase = {
      operationID,
      tick: checkpoint.ticks,
      simulatedElapsedSeconds: checkpoint.simulatedElapsedSeconds,
      targetElapsedSeconds,
      time: checkpoint.updatedAt,
      resumedFromCheckpoint,
    }
    const daemonHeartbeat: BurnInHeartbeat = { ...heartbeatBase, kind: "daemon" }
    const schedulerHeartbeat: BurnInHeartbeat = { ...heartbeatBase, kind: "scheduler" }
    await writeJson(daemonHeartbeatPath, daemonHeartbeat)
    await writeJson(schedulerHeartbeatPath, schedulerHeartbeat)
    await appendJsonl(logPath, daemonHeartbeat)
    await appendJsonl(logPath, schedulerHeartbeat)
    await writeJson(checkpointPath, checkpoint)
  }

  const audit = auditBurnIn(checkpoint)
  const proof: BurnInProof = {
    operationID,
    elapsedTargetSeconds: targetElapsedSeconds,
    simulatedElapsedSeconds: checkpoint.simulatedElapsedSeconds,
    ticks: checkpoint.ticks,
    daemonHeartbeats: checkpoint.daemonHeartbeats,
    schedulerHeartbeats: checkpoint.schedulerHeartbeats,
    restartCount: checkpoint.restartCount,
    auditStatus: audit.status,
    resumedFromCheckpoint,
    startedAt,
    endedAt: checkpoint.updatedAt,
    heartbeatPaths: {
      daemon: daemonHeartbeatPath,
      scheduler: schedulerHeartbeatPath,
    },
    checkpointPath,
  }

  const result: BurnInHarnessResult = {
    operationID,
    root,
    checkpointPath,
    daemonHeartbeatPath,
    schedulerHeartbeatPath,
    logPath,
    auditPath,
    proofPath,
    checkpoint,
    proof,
    audit,
  }
  await writeJson(checkpointPath, checkpoint)
  await writeJson(proofPath, proof)
  await fs.mkdir(path.dirname(auditPath), { recursive: true })
  await fs.writeFile(auditPath, formatAudit(result))
  return result
}

export function formatBurnInHarness(result: BurnInHarnessResult) {
  return [
    `# ULM Burn-In Proof: ${result.operationID}`,
    "",
    `- audit_status: ${result.audit.status}`,
    `- elapsed_target_seconds: ${result.proof.elapsedTargetSeconds}`,
    `- ticks: ${result.proof.ticks}`,
    `- daemon_heartbeats: ${result.proof.daemonHeartbeats}`,
    `- scheduler_heartbeats: ${result.proof.schedulerHeartbeats}`,
    `- restart_count: ${result.proof.restartCount}`,
    `- proof: ${result.proofPath}`,
  ].join("\n")
}
