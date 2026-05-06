import fs from "fs/promises"
import path from "path"
import type { BackgroundJob } from "@/background/job"
import { operationPath, slug } from "./artifact"
import { decideOperationNext, type OperationNextAction } from "./operation-next"
import type { OperationGraphRecord, OperationLane } from "./operation-graph"
import { syncWorkQueueJobs } from "./work-queue"

export type OperationRunMode = "advance" | "complete_lane" | "fail_lane"

export type OperationRunInput = {
  operationID: string
  mode?: OperationRunMode
  laneID?: string
  jobID?: string
  summary?: string
  artifacts?: readonly string[]
  evidenceRefs?: readonly string[]
  autoComplete?: boolean
  backgroundJobs?: BackgroundJob.Info[]
}

export type OperationRunResult = {
  operationID: string
  mode: OperationRunMode
  action: OperationNextAction["action"]
  reason: string
  laneID?: string
  graphPath: string
  runLogPath: string
  taskParams?: {
    description: string
    prompt: string
    subagent_type: string
    operationID: string
    laneID: string
    modelRoute: string
    background: boolean
  }
  commandProfiles?: string[]
  completedLanes: string[]
  failedLanes: string[]
  syncedJobs: string[]
  syncedWorkUnits: string[]
  completedWorkUnits: string[]
  failedWorkUnits: string[]
  blockers: string[]
}

export type LaneCompletionProof = {
  operationID: string
  laneID: string
  status: "complete"
  completedAt: string
  summary: string
  artifacts: string[]
  evidenceRefs: string[]
  jobID?: string
}

type RunLogRecord = {
  time: string
  mode: OperationRunMode
  laneID?: string
  jobID?: string
  summary?: string
  action: OperationRunResult["action"]
  reason: string
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

async function appendJsonl(file: string, value: RunLogRecord) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(value) + "\n")
}

function graphPaths(worktree: string, operationID: string) {
  const root = operationPath(worktree, operationID)
  return {
    root,
    graphPath: path.join(root, "plans", "operation-graph.json"),
    runLogPath: path.join(root, "plans", "operation-run.jsonl"),
  }
}

function laneProofPath(root: string, laneID: string) {
  return path.join(root, "lane-complete", `${laneID}.json`)
}

function findLane(graph: OperationGraphRecord, laneID: string) {
  const lane = graph.lanes.find((item) => item.id === laneID)
  if (!lane) throw new Error(`lane ${laneID} is missing from operation graph`)
  return lane
}

function markDependentsReady(graph: OperationGraphRecord) {
  const complete = new Set(graph.lanes.filter((lane) => lane.status === "complete").map((lane) => lane.id))
  for (const lane of graph.lanes) {
    if (lane.status === "pending" && lane.dependsOn.every((dependency) => complete.has(dependency))) {
      lane.status = "ready"
    }
  }
}

async function expectedArtifactExists(root: string, expected: string) {
  const relative = expected.replace(/\/+$/g, "")
  if (!relative || relative.includes("*") || path.isAbsolute(relative)) return false
  const resolved = path.resolve(root, relative)
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) return false
  try {
    const stat = await fs.stat(resolved)
    if (stat.isDirectory()) {
      const entries = await fs.readdir(resolved)
      return entries.length > 0
    }
    return stat.size > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function artifactCoversExpected(artifact: string, expected: string) {
  const cleanArtifact = artifact.replace(/\/+$/g, "")
  const cleanExpected = expected.replace(/\/+$/g, "")
  if (expected.endsWith("/")) return cleanArtifact === cleanExpected || cleanArtifact.startsWith(`${cleanExpected}/`)
  return cleanArtifact === cleanExpected
}

function laneRequiresEvidenceRefs(lane: OperationLane) {
  return ["evidence_normalization", "finding_validation", "report_writing", "report_review", "operator_summary"].includes(lane.id)
}

async function validateLaneCompletionProof(root: string, lane: OperationLane, proof: LaneCompletionProof) {
  const blockers: string[] = []
  if (proof.operationID !== lane.operationID) blockers.push("proof operationID does not match lane")
  if (proof.laneID !== lane.id) blockers.push("proof laneID does not match lane")
  if (proof.status !== "complete") blockers.push("proof status must be complete")
  if (!proof.summary.trim()) blockers.push("proof summary is required")
  if (!proof.artifacts.length) blockers.push("proof artifacts are required")
  if (laneRequiresEvidenceRefs(lane) && !proof.evidenceRefs.length) blockers.push(`${lane.id}: evidenceRefs are required`)
  for (const artifact of proof.artifacts) {
    if (!artifact || path.isAbsolute(artifact) || artifact.includes("..")) {
      blockers.push(`invalid proof artifact path: ${artifact}`)
      continue
    }
    if (!(await expectedArtifactExists(root, artifact))) blockers.push(`proof artifact is missing or empty: ${artifact}`)
  }
  for (const expected of lane.expectedArtifacts) {
    if (!proof.artifacts.some((artifact) => artifactCoversExpected(artifact, expected))) {
      blockers.push(`proof does not cover expected artifact: ${expected}`)
    }
  }
  return blockers
}

async function proofIsValid(root: string, lane: OperationLane, proof: LaneCompletionProof) {
  try {
    return (await validateLaneCompletionProof(root, lane, proof)).length === 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function validateInputProof(root: string, lane: OperationLane, input: OperationRunInput) {
  const proof: LaneCompletionProof = {
    operationID: lane.operationID,
    laneID: lane.id,
    status: "complete",
    completedAt: new Date().toISOString(),
    summary: input.summary?.trim() || "",
    artifacts: [...(input.artifacts ?? [])],
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    ...(input.jobID ? { jobID: input.jobID } : {}),
  }
  return { proof, blockers: await validateLaneCompletionProof(root, lane, proof) }
}

async function persistLaneCompletionProof(root: string, proof: LaneCompletionProof) {
  await writeJson(laneProofPath(root, proof.laneID), proof)
}

async function readLaneCompletionProof(root: string, lane: OperationLane) {
  const proof = await readJson<LaneCompletionProof>(laneProofPath(root, lane.id))
  if (!proof) return undefined
  if (proof.operationID !== lane.operationID) return undefined
  if (proof.laneID !== lane.id) return undefined
  if (proof.status !== "complete") return undefined
  return proof
}

async function autoCompleteLanes(root: string, graph: OperationGraphRecord) {
  const completed: string[] = []
  for (const lane of graph.lanes) {
    if (lane.status !== "running") continue
    const proof = await readLaneCompletionProof(root, lane)
    if (!proof) continue
    if (!(await proofIsValid(root, lane, proof))) continue
    lane.status = "complete"
    completed.push(lane.id)
  }
  if (completed.length) markDependentsReady(graph)
  return completed
}

async function syncBackgroundJobs(root: string, graph: OperationGraphRecord, operationID: string, jobs: BackgroundJob.Info[] | undefined) {
  const completed: string[] = []
  const failed: string[] = []
  const synced: string[] = []
  if (!jobs?.length) return { completed, failed, synced }

  for (const job of jobs) {
    const metadataOperation = job.metadata?.operationID
    const laneID = job.metadata?.laneID
    if (metadataOperation !== operationID || typeof laneID !== "string" || !laneID) continue
    const lane = graph.lanes.find((item) => item.id === laneID)
    if (!lane) continue
    lane.activeJobs = [
      ...(lane.activeJobs ?? []).filter((item) => item.id !== job.id),
      {
        id: job.id,
        type: job.type,
        status: job.status,
        updatedAt: new Date(job.completedAt ?? job.startedAt).toISOString(),
      },
    ]
    synced.push(job.id)
    if (job.status === "running" && lane.status !== "complete") lane.status = "running"
    if (job.status === "completed" && lane.status !== "complete") {
      const proof = await readLaneCompletionProof(root, lane)
      if (!proof || !(await proofIsValid(root, lane, proof))) continue
      lane.status = "complete"
      completed.push(lane.id)
    }
    if ((job.status === "error" || job.status === "cancelled" || job.status === "stale") && lane.status !== "failed") {
      lane.status = "failed"
      failed.push(lane.id)
    }
  }
  if (completed.length) markDependentsReady(graph)
  return { completed, failed, synced }
}

function commandProfilesForLane(lane: OperationLane) {
  if (lane.id === "recon") return ["service-inventory"]
  if (lane.id === "web_inventory") return ["http-discovery", "content-discovery", "passive-web-baseline"]
  return []
}

function taskParamsForLane(lane: OperationLane) {
  return {
    description: lane.title.slice(0, 60),
    prompt: [
      `Run ULM operation lane "${lane.id}" for operation "${lane.operationID}".`,
      "",
      `Use model route: ${lane.modelRoute}`,
      `Allowed tools: ${lane.allowedTools.join(", ")}`,
      `Expected artifacts: ${lane.expectedArtifacts.join(", ")}`,
      "",
      "Checkpoint material progress, preserve evidence references, and finish with a lane summary, blockers, and validation limits.",
    ].join("\n"),
    subagent_type: lane.agent,
    operationID: lane.operationID,
    laneID: lane.id,
    modelRoute: lane.modelRoute,
    background: true,
  }
}

async function persistRun(worktree: string, graph: OperationGraphRecord, record: RunLogRecord) {
  const { graphPath, runLogPath } = graphPaths(worktree, graph.operationID)
  graph.updatedAt = record.time
  await writeJson(graphPath, graph)
  await appendJsonl(runLogPath, record)
  return { graphPath, runLogPath }
}

export async function runOperationStep(worktree: string, input: OperationRunInput): Promise<OperationRunResult> {
  const operationID = slug(input.operationID, "operation")
  const mode = input.mode ?? "advance"
  const { root, graphPath } = graphPaths(worktree, operationID)
  const graph = await readJson<OperationGraphRecord>(graphPath)
  if (!graph) throw new Error("operation graph is missing; run operation_schedule first")
  const completedLanes: string[] = []
  const failedLanes: string[] = []
  const syncedJobs: string[] = []
  const syncedWorkUnits: string[] = []
  const completedWorkUnits: string[] = []
  const failedWorkUnits: string[] = []
  const blockers: string[] = []

  if (input.autoComplete ?? true) completedLanes.push(...(await autoCompleteLanes(root, graph)))
  const jobSync = await syncBackgroundJobs(root, graph, operationID, input.backgroundJobs)
  completedLanes.push(...jobSync.completed.filter((lane) => !completedLanes.includes(lane)))
  failedLanes.push(...jobSync.failed.filter((lane) => !failedLanes.includes(lane)))
  syncedJobs.push(...jobSync.synced)
  const queueSync = await syncWorkQueueJobs(worktree, { operationID, backgroundJobs: input.backgroundJobs })
  syncedWorkUnits.push(...queueSync.syncedUnits)
  completedWorkUnits.push(...queueSync.completedUnits)
  failedWorkUnits.push(...queueSync.failedUnits)

  if (mode === "complete_lane" || mode === "fail_lane") {
    if (!input.laneID) throw new Error(`${mode} requires laneID`)
    const lane = findLane(graph, input.laneID)
    if (mode === "complete_lane") {
      const proof = await validateInputProof(root, lane, input)
      if (proof.blockers.length) {
        blockers.push(...proof.blockers)
      } else {
        await persistLaneCompletionProof(root, proof.proof)
        lane.status = "complete"
        completedLanes.push(lane.id)
        markDependentsReady(graph)
      }
    } else {
      lane.status = "failed"
      failedLanes.push(lane.id)
    }
  }

  if (completedLanes.length || failedLanes.length) {
    graph.updatedAt = new Date().toISOString()
    await writeJson(graphPath, graph)
  }

  const next = await decideOperationNext(worktree, { operationID })
  let taskParams: OperationRunResult["taskParams"]
  let commandProfiles: string[] = []
  let laneID = "lane" in next.action ? next.action.lane.id : "laneID" in next.action ? next.action.laneID : undefined

  if (mode === "advance" && next.action.action === "launch_lane") {
    const lane = findLane(graph, next.action.lane.id)
    lane.status = "running"
    laneID = lane.id
    taskParams = taskParamsForLane(lane)
    commandProfiles = commandProfilesForLane(lane)
  }

  const reason =
    mode === "advance" && next.action.action === "launch_lane"
      ? `marked lane ${laneID} running and prepared launch parameters`
      : next.action.reason
  const { graphPath: persistedGraphPath, runLogPath: persistedRunLogPath } = await persistRun(worktree, graph, {
    time: new Date().toISOString(),
    mode,
    laneID,
    jobID: input.jobID,
    summary: input.summary,
    action: next.action.action,
    reason,
  })

  return {
    operationID,
    mode,
    action: next.action.action,
    reason,
    laneID,
    graphPath: persistedGraphPath,
    runLogPath: persistedRunLogPath,
    taskParams,
    commandProfiles,
    completedLanes,
    failedLanes,
    syncedJobs,
    syncedWorkUnits,
    completedWorkUnits,
    failedWorkUnits,
    blockers: [...blockers, ...next.action.blockers],
  }
}

export function formatOperationRun(result: OperationRunResult) {
  return [
    `# Operation Run Step: ${result.operationID}`,
    "",
    `- mode: ${result.mode}`,
    `- action: ${result.action}`,
    `- reason: ${result.reason}`,
    `- lane: ${result.laneID ?? "none"}`,
    `- graph: ${result.graphPath}`,
    `- run_log: ${result.runLogPath}`,
    "",
    "## Completed Lanes",
    "",
    ...(result.completedLanes.length ? result.completedLanes.map((lane) => `- ${lane}`) : ["- none"]),
    "",
    "## Failed Lanes",
    "",
    ...(result.failedLanes.length ? result.failedLanes.map((lane) => `- ${lane}`) : ["- none"]),
    "",
    "## Synced Jobs",
    "",
    ...(result.syncedJobs.length ? result.syncedJobs.map((job) => `- ${job}`) : ["- none"]),
    "",
    "## Synced Work Units",
    "",
    ...(result.syncedWorkUnits.length ? result.syncedWorkUnits.map((unit) => `- ${unit}`) : ["- none"]),
    "",
    "## Launch Parameters",
    "",
    result.taskParams ? JSON.stringify(result.taskParams, null, 2) : "No model lane launch needed.",
    "",
    "## Command Profiles",
    "",
    ...(result.commandProfiles?.length ? result.commandProfiles.map((profile) => `- ${profile}`) : ["- none"]),
    "",
    "<operation_run_json>",
    JSON.stringify(result, null, 2),
    "</operation_run_json>",
  ].join("\n")
}
