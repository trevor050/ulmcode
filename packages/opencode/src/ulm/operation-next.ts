import fs from "fs/promises"
import path from "path"
import { operationPath, slug, type RuntimeSummaryRecord } from "./artifact"
import type { GovernorDecision } from "./runtime-governor"
import { evaluateRuntimeGovernor } from "./runtime-governor"
import type { OperationGraphRecord, OperationLane } from "./operation-graph"

export type OperationNextAction =
  | {
      operationID: string
      action: "schedule"
      reason: string
      recommendedTools: string[]
      blockers: string[]
    }
  | {
      operationID: string
      action: "compact" | "stop" | "wait"
      reason: string
      laneID?: string
      recommendedTools: string[]
      blockers: string[]
      governor?: GovernorDecision
    }
  | {
      operationID: string
      action: "launch_lane"
      reason: string
      lane: OperationLane
      prompt: string
      recommendedTools: string[]
      blockers: string[]
      governor: GovernorDecision
    }

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function dependenciesComplete(graph: OperationGraphRecord, lane: OperationLane) {
  const complete = new Set(graph.lanes.filter((item) => item.status === "complete").map((item) => item.id))
  return lane.dependsOn.every((dependency) => complete.has(dependency))
}

function runningLanes(graph: OperationGraphRecord) {
  return graph.lanes.filter((lane) => lane.status === "running")
}

function blockedDependencies(graph: OperationGraphRecord, lane: OperationLane) {
  const byID = new Map(graph.lanes.map((item) => [item.id, item]))
  return lane.dependsOn.filter((dependency) => byID.get(dependency)?.status !== "complete")
}

function selectReadyLane(graph: OperationGraphRecord) {
  return graph.lanes.find((lane) => {
    if (lane.status !== "ready" && lane.status !== "pending") return false
    return dependenciesComplete(graph, lane)
  })
}

function promptForLane(lane: OperationLane) {
  return [
    `Run operation lane "${lane.id}" for operation "${lane.operationID}".`,
    "",
    `Agent lane: ${lane.agent}`,
    `Model route: ${lane.modelRoute}`,
    `Allowed tools: ${lane.allowedTools.join(", ")}`,
    `Expected artifacts: ${lane.expectedArtifacts.join(", ")}`,
    `Restart policy: max ${lane.restartPolicy.maxAttempts} attempts, stale after ${lane.restartPolicy.staleAfterMinutes} minutes.`,
    "",
    "Work only within the lane scope, checkpoint progress, preserve evidence references, and return a concise lane summary with blockers.",
  ].join("\n")
}

async function writeNextAction(worktree: string, action: OperationNextAction) {
  const root = operationPath(worktree, action.operationID)
  const file = path.join(root, "plans", "next-action.json")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(action, null, 2) + "\n")
  return file
}

export async function decideOperationNext(worktree: string, input: { operationID: string }) {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const graph = await readJson<OperationGraphRecord>(path.join(root, "plans", "operation-graph.json"))
  const runtime = await readJson<RuntimeSummaryRecord>(path.join(root, "deliverables", "runtime-summary.json"))

  if (!graph) {
    const action: OperationNextAction = {
      operationID,
      action: "schedule",
      reason: "operation graph is missing",
      recommendedTools: ["operation_schedule", "operation_plan"],
      blockers: ["operation graph is missing"],
    }
    return { action, path: await writeNextAction(worktree, action) }
  }

  if (!runtime) {
    const action: OperationNextAction = {
      operationID,
      action: "compact",
      reason: "runtime summary is missing",
      recommendedTools: ["runtime_summary", "operation_status"],
      blockers: ["runtime summary is missing"],
    }
    return { action, path: await writeNextAction(worktree, action) }
  }

  const running = runningLanes(graph)
  if (running.length >= graph.maxConcurrentLanes) {
    const action: OperationNextAction = {
      operationID,
      action: "wait",
      reason: `max concurrent lanes already running (${running.length}/${graph.maxConcurrentLanes})`,
      laneID: running[0]?.id,
      recommendedTools: ["task_status", "operation_status", "runtime_summary"],
      blockers: [],
    }
    return { action, path: await writeNextAction(worktree, action) }
  }

  const lane = selectReadyLane(graph)
  if (!lane) {
    const incomplete = graph.lanes.find((item) => item.status !== "complete")
    const blockers = incomplete ? blockedDependencies(graph, incomplete).map((dependency) => `${incomplete.id} waits for ${dependency}`) : []
    const action: OperationNextAction = {
      operationID,
      action: incomplete ? "wait" : "stop",
      reason: incomplete ? "no lane is ready because dependencies are still incomplete" : "all operation lanes are complete",
      laneID: incomplete?.id,
      recommendedTools: incomplete ? ["operation_status", "task_status"] : ["operation_audit", "report_lint"],
      blockers,
    }
    return { action, path: await writeNextAction(worktree, action) }
  }

  const governor = await evaluateRuntimeGovernor(worktree, { operationID, laneID: lane.id })
  if (governor.action !== "continue") {
    const action: OperationNextAction = {
      operationID,
      action: governor.action,
      reason: governor.reason,
      laneID: lane.id,
      recommendedTools: governor.recommendedTools,
      blockers: governor.blockers,
      governor,
    }
    return { action, path: await writeNextAction(worktree, action) }
  }

  const action: OperationNextAction = {
    operationID,
    action: "launch_lane",
    reason: `lane ${lane.id} is ready and within governor limits`,
    lane,
    prompt: promptForLane(lane),
    recommendedTools: lane.allowedTools,
    blockers: [],
    governor,
  }
  return { action, path: await writeNextAction(worktree, action) }
}

function laneIDForAction(action: OperationNextAction) {
  if ("lane" in action) return action.lane.id
  if ("laneID" in action) return action.laneID
  return undefined
}

export function formatOperationNext(action: OperationNextAction, file: string) {
  const lane = laneIDForAction(action)
  return [
    `# Next Operation Action: ${action.operationID}`,
    "",
    `- action: ${action.action}`,
    `- reason: ${action.reason}`,
    `- lane: ${lane ?? "none"}`,
    `- artifact: ${file}`,
    "",
    "## Recommended Tools",
    "",
    ...action.recommendedTools.map((item) => `- ${item}`),
    "",
    "## Blockers",
    "",
    ...(action.blockers.length ? action.blockers.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Prompt",
    "",
    "prompt" in action ? action.prompt : "No lane launch prompt for this action.",
    "",
    "<next_action_json>",
    JSON.stringify(action, null, 2),
    "</next_action_json>",
  ].join("\n")
}
