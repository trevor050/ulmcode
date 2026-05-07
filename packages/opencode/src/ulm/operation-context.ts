import fs from "fs/promises"
import path from "path"
import { operationPath, operationsRoot } from "./artifact"
import type { OperationGoalRecord } from "./operation-goal"
import { effectiveULMContinuation, type ULMRuntimeConfig } from "./config"

export type ActiveOperationContext = {
  worktree: string
  operationID: string
  goal: OperationGoalRecord
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    return undefined
  }
}

function parseTime(value: string | undefined) {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

export async function activeOperationGoal(worktree: string): Promise<ActiveOperationContext | undefined> {
  const root = operationsRoot(worktree)
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch {
    return undefined
  }
  const goals = (
    await Promise.all(
      entries.map(async (entry) => ({
        operationID: entry,
        goal: await readJson<OperationGoalRecord>(path.join(root, entry, "goals", "operation-goal.json")),
      })),
    )
  )
    .filter((entry): entry is { operationID: string; goal: OperationGoalRecord } => entry.goal?.status === "active")
    .sort((a, b) => parseTime(b.goal.updatedAt ?? b.goal.createdAt) - parseTime(a.goal.updatedAt ?? a.goal.createdAt))
  const latest = goals[0]
  if (!latest) return undefined
  return { worktree, operationID: latest.goal.operationID ?? latest.operationID, goal: latest.goal }
}

export async function activeOperationForContext(ctx: {
  worktree: string
  directory: string
}): Promise<ActiveOperationContext | undefined> {
  return (await activeOperationGoal(ctx.worktree)) ?? (await activeOperationGoal(ctx.directory))
}

export type OperationPlanExcerpt = {
  path?: string
  format?: "json" | "markdown"
  maxChars: number
  truncated: boolean
  chars: number
  content?: string
}

async function readPlanCandidate(file: string, format: OperationPlanExcerpt["format"], maxChars: number) {
  try {
    const raw = await fs.readFile(file, "utf8")
    const content = raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n[ULM operation plan truncated at ${maxChars} chars]` : raw
    return {
      path: file,
      format,
      maxChars,
      truncated: raw.length > maxChars,
      chars: raw.length,
      content,
    } satisfies OperationPlanExcerpt
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

export async function readOperationPlanExcerpt(
  worktree: string,
  operationID: string,
  maxChars: number,
): Promise<OperationPlanExcerpt> {
  const root = operationPath(worktree, operationID)
  return (
    (await readPlanCandidate(path.join(root, "plans", "operation-plan.json"), "json", maxChars)) ??
    (await readPlanCandidate(path.join(root, "plans", "operation-plan.md"), "markdown", maxChars)) ?? {
      maxChars,
      truncated: false,
      chars: 0,
    }
  )
}

export function operationAllowsUnattendedFallback(goal: OperationGoalRecord | undefined, config: ULMRuntimeConfig = {}) {
  if (goal?.status !== "active") return false
  const continuation = effectiveULMContinuation(goal, config)
  return continuation.enabled && continuation.operatorFallbackEnabled
}
