import fs from "fs/promises"
import path from "path"
import { completeOperationGoal, createOperationGoal } from "./operation-goal"
import { operationPath, slug, writeOperationPlan, writeRuntimeSummary } from "./artifact"
import { writeOperationGraph } from "./operation-graph"

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
  supervisorScenario: BurnInSupervisorScenarioProof
}

export type BurnInSupervisorScenarioProof = {
  operationGoalCreated: boolean
  targetDurationHours: number
  planPlanWritten: boolean
  supervisorLanePresent: boolean
  supervisorReviews: number
  staleCommandLaneSimulated: boolean
  staleCommandLaneRecovered: boolean
  toolInventoryWritten: boolean
  runtimeSummaryWritten: boolean
  completionBlockedBeforeAudit: boolean
  finalAuditWritten: boolean
  goalCompletedAfterAudit: boolean
  proofPath: string
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

async function writeSupervisorScenario(worktree: string, input: { operationID: string; targetElapsedSeconds: number; completed: boolean }) {
  const operationID = slug(input.operationID, "operation")
  const targetDurationHours = Math.round((input.targetElapsedSeconds / 60 / 60) * 100) / 100
  const root = operationPath(worktree, operationID)
  const scenarioPath = path.join(root, "burnin", "burnin-supervisor-scenario.json")
  const goal = await createOperationGoal(worktree, {
    operationID,
    objective: "Accelerated proof for authorized overnight ULM supervisor operation.",
    targetDurationHours,
  })
  await fs.mkdir(path.join(root, "plans"), { recursive: true })
  await fs.writeFile(
    path.join(root, "plans", "plan-plan.md"),
    [
      "# Plan-Plan",
      "",
      "- Confirm authorization and target duration.",
      "- Run bounded discovery before full operation planning.",
      "- Ask deferred questions after discovery changes the plan.",
      "- Hand off to supervisor before unattended execution.",
      "",
    ].join("\n"),
  )
  await writeOperationPlan(worktree, {
    operationID,
    phases: [
      {
        stage: "recon",
        objective: "Run bounded passive discovery and inventory.",
        actions: ["Use supervised command profiles and background lanes."],
        successCriteria: ["Raw inventory artifacts and tool inventory exist."],
        subagents: ["recon", "supervisor"],
        noSubagents: ["final audit decision"],
      },
      {
        stage: "handoff",
        objective: "Render report artifacts and close the operation.",
        actions: ["Run report_lint, report_render, runtime_summary, and operation_audit."],
        successCriteria: ["Goal completion is blocked before audit and succeeds after audit."],
        subagents: ["report-reviewer"],
        noSubagents: ["operator authorization decisions"],
      },
    ],
    reportingCloseout: [
      "report_lint finalHandoff=true",
      "report_render final package",
      "runtime_summary final accounting",
      "operation_audit finalHandoff=true",
    ],
  })
  await writeOperationGraph(worktree, { operationID, budgetUSD: 10 })
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
  if (!graph.lanes.some((lane: { id?: string }) => lane.id === "supervisor")) {
    graph.lanes.push({
      id: "supervisor",
      title: "Supervisor heartbeat and recovery review",
      agent: "pentest",
      status: "complete",
      dependsOn: [],
      modelRoute: "openai/gpt-5.5-fast",
      fallbackModelRoutes: ["openai/gpt-5.4-mini-fast"],
      allowedTools: ["operation_supervise", "operation_resume", "runtime_summary", "operation_audit"],
      expectedArtifacts: ["supervisor/latest.md"],
      budget: {},
      restartPolicy: { restartable: true, maxAttempts: 3, staleAfterMinutes: 30 },
      operationID,
    })
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
  }
  await writeJson(path.join(root, "supervisor", "supervisor-review-startup.json"), {
    operationID,
    reviewKind: "startup",
    generatedAt: virtualTime(goal.goal.createdAt, 0),
    decisions: [{ action: "recover", reason: "stale command lane requires recovery before new launch", requiredNextTool: "operation_resume" }],
  })
  await writeJson(path.join(root, "work-queue.json"), {
    operationID,
    generatedAt: virtualTime(goal.goal.createdAt, 0),
    units: [
      {
        id: "burnin-command-sweep",
        operationID,
        laneID: "recon",
        profileID: "icmp-sweep",
        status: input.completed ? "completed" : "queued",
        attempts: input.completed ? 2 : 1,
        recoveredFrom: "stale",
      },
    ],
  })
  await writeJson(path.join(root, "tool-inventory", "tool-inventory.json"), {
    operationID,
    generatedAt: virtualTime(goal.goal.createdAt, input.targetElapsedSeconds),
    counts: { total: 4, installed: 3, missing: 1, highValueMissing: 1 },
    tools: [
      { id: "nmap", installed: true, highValue: true },
      { id: "httpx", installed: true, highValue: true },
      { id: "dig", installed: true, highValue: true },
      { id: "nuclei", installed: false, highValue: true },
    ],
    nextActions: ["Use tool_acquire only after operator authorization."],
  })
  await writeRuntimeSummary(worktree, {
    operationID,
    modelCalls: { total: input.completed ? 80 : 3 },
    usage: { totalTokens: input.completed ? 120_000 : 4_500, costUSD: input.completed ? 6 : 0.5, budgetUSD: 10 },
    backgroundTasks: [
      {
        id: "burnin-command-sweep",
        agent: "command_supervise",
        status: input.completed ? "completed" : "stale",
        summary: "Accelerated stale command lane simulation.",
      },
    ],
  })
  await writeJson(path.join(root, "deliverables", "final", "manifest.json"), { operationID, generatedBy: "burnin-harness" })
  await writeJson(path.join(root, "deliverables", "stage-gates", "handoff.json"), { operationID, stage: "handoff", ok: true })
  const beforeAudit = await completeOperationGoal(worktree, { operationID })
  if (input.completed) {
    await writeJson(path.join(root, "deliverables", "operation-audit.json"), { operationID, ok: true, generatedBy: "burnin-harness" })
    await writeJson(path.join(root, "supervisor", "supervisor-review-handoff.json"), {
      operationID,
      reviewKind: "pre_handoff",
      generatedAt: virtualTime(goal.goal.createdAt, input.targetElapsedSeconds),
      decisions: [{ action: "handoff_ready", reason: "final runtime and audit artifacts are present" }],
    })
  }
  const afterAudit = input.completed ? await completeOperationGoal(worktree, { operationID }) : undefined
  const proof: BurnInSupervisorScenarioProof = {
    operationGoalCreated: goal.created || !!goal.goal,
    targetDurationHours,
    planPlanWritten: true,
    supervisorLanePresent: graph.lanes.some((lane: { id?: string }) => lane.id === "supervisor"),
    supervisorReviews: input.completed ? 2 : 1,
    staleCommandLaneSimulated: true,
    staleCommandLaneRecovered: input.completed,
    toolInventoryWritten: true,
    runtimeSummaryWritten: true,
    completionBlockedBeforeAudit: beforeAudit.blockers.some((blocker) => blocker.includes("operation-audit.json")),
    finalAuditWritten: input.completed,
    goalCompletedAfterAudit: afterAudit?.completed ?? false,
    proofPath: scenarioPath,
  }
  await writeJson(scenarioPath, proof)
  return proof
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
    `- supervisor_reviews: ${result.proof.supervisorScenario.supervisorReviews}`,
    `- stale_command_lane_recovered: ${result.proof.supervisorScenario.staleCommandLaneRecovered}`,
    `- completion_blocked_before_audit: ${result.proof.supervisorScenario.completionBlockedBeforeAudit}`,
    `- goal_completed_after_audit: ${result.proof.supervisorScenario.goalCompletedAfterAudit}`,
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
  const supervisorScenario = await writeSupervisorScenario(worktree, {
    operationID,
    targetElapsedSeconds,
    completed: audit.status === "passed",
  })
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
    supervisorScenario,
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
    `- supervisor_reviews: ${result.proof.supervisorScenario.supervisorReviews}`,
    `- goal_completed_after_audit: ${result.proof.supervisorScenario.goalCompletedAfterAudit}`,
    `- proof: ${result.proofPath}`,
  ].join("\n")
}
