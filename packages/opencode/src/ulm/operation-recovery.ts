import fs from "fs/promises"
import path from "path"
import type { BackgroundJob } from "@/background/job"
import { operationPath, slug } from "./artifact"
import type { OperationGraphRecord } from "./operation-graph"

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

function laneID(job: BackgroundJob.Info) {
  const value = job.metadata?.laneID
  return typeof value === "string" && value ? value : undefined
}

export function restartableOperationJobs(input: { operationID: string; jobs: BackgroundJob.Info[]; maxJobs?: number }) {
  const operationID = slug(input.operationID, "operation")
  const limit = input.maxJobs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(input.maxJobs))
  return input.jobs
    .filter((job) => job.metadata?.operationID === operationID)
    .filter((job) => job.status === "stale" || job.status === "error" || job.status === "cancelled")
    .filter((job) => {
      if (job.type === "task") return typeof job.metadata?.prompt === "string" && typeof job.metadata?.subagent_type === "string"
      if (job.type === "command_supervise") return typeof job.metadata?.profileID === "string"
      return false
    })
    .slice(0, limit)
}

export async function markRecoveredLanesRunning(worktree: string, input: { operationID: string; jobs: BackgroundJob.Info[] }) {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const graph = await readJson<OperationGraphRecord>(graphPath)
  if (!graph) return []
  const recovered: string[] = []
  for (const job of input.jobs) {
    const id = laneID(job)
    if (!id) continue
    const lane = graph.lanes.find((item) => item.id === id)
    if (!lane || lane.status === "complete") continue
    lane.status = "running"
    lane.activeJobs = [
      ...(lane.activeJobs ?? []).filter((item) => item.id !== job.id),
      {
        id: job.id,
        type: job.type,
        status: "running",
        updatedAt: new Date().toISOString(),
      },
    ]
    recovered.push(id)
  }
  if (!recovered.length) return recovered
  graph.updatedAt = new Date().toISOString()
  await writeJson(graphPath, graph)
  await fs.mkdir(path.join(root, "plans"), { recursive: true })
  await fs.appendFile(
    path.join(root, "plans", "operation-run.jsonl"),
    JSON.stringify({
      time: graph.updatedAt,
      mode: "recover_lane",
      recoveredLanes: recovered,
      action: "recover",
      reason: `marked ${recovered.length} recovered lane${recovered.length === 1 ? "" : "s"} running`,
    }) + "\n",
  )
  return recovered
}
