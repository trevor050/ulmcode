import fs from "fs/promises"
import path from "path"
import { randomInt, randomUUID } from "crypto"
import { operationPath, slug } from "./artifact"

export type OperationGoalStatus = "active" | "complete"

export type OperationGoalCompletionPolicy = {
  requiresOperationAudit: boolean
  requiresRuntimeSummary: boolean
  requiresReportRender: boolean
  requiresStageGate?: string
}

export type OperationGoalContinuation = {
  enabled: boolean
  idleMinutesBeforeReview: number
  maxNoToolContinuationTurns: number
  turnEndReview: boolean
  injectPlanMaxChars: number
  operatorFallbackTimeoutSeconds: number
  operatorFallbackEnabled: boolean
  maxRepeatedOperatorTimeoutsPerKind: number
}

export type OperationGoalRecord = {
  operationID: string
  objective: string
  targetDurationHours?: number
  status: OperationGoalStatus
  completionPolicy: OperationGoalCompletionPolicy
  continuation: OperationGoalContinuation
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type OperationGoalCreateInput = {
  operationID?: string
  objective: string
  targetDurationHours?: number
  completionPolicy?: Partial<OperationGoalCompletionPolicy>
  continuation?: Partial<OperationGoalContinuation>
}

export type OperationGoalCompleteInput = {
  operationID: string
}

export type OperationGoalFiles = {
  json: string
  markdown: string
  blockers: string
}

export type OperationGoalCreateResult = {
  operationID: string
  created: boolean
  goal: OperationGoalRecord
  files: OperationGoalFiles
}

export type OperationGoalReadResult = {
  operationID: string
  goal?: OperationGoalRecord
  files: OperationGoalFiles
}

export type OperationGoalCompleteResult = {
  operationID: string
  completed: boolean
  blockers: string[]
  goal?: OperationGoalRecord
  files: OperationGoalFiles
}

const defaultCompletionPolicy: OperationGoalCompletionPolicy = {
  requiresOperationAudit: true,
  requiresRuntimeSummary: true,
  requiresReportRender: true,
  requiresStageGate: "handoff",
}

const defaultContinuation: OperationGoalContinuation = {
  enabled: true,
  idleMinutesBeforeReview: 10,
  maxNoToolContinuationTurns: 1,
  turnEndReview: true,
  injectPlanMaxChars: 12_000,
  operatorFallbackTimeoutSeconds: 75,
  operatorFallbackEnabled: true,
  maxRepeatedOperatorTimeoutsPerKind: 2,
}

const operationNameWords = [
  "amber",
  "arcade",
  "beacon",
  "brisk",
  "cobalt",
  "comet",
  "cosmic",
  "daring",
  "ember",
  "frost",
  "glimmer",
  "harbor",
  "jazz",
  "lucky",
  "matrix",
  "neon",
  "orbit",
  "pixel",
  "quartz",
  "rocket",
  "signal",
  "solar",
  "summit",
  "velvet",
  "wild",
] as const

function goalFiles(worktree: string, operationID: string): OperationGoalFiles {
  const dir = path.join(operationPath(worktree, operationID), "goals")
  return {
    json: path.join(dir, "operation-goal.json"),
    markdown: path.join(dir, "operation-goal.md"),
    blockers: path.join(dir, "completion-blockers.json"),
  }
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

async function readableFile(file: string) {
  try {
    const stat = await fs.stat(file)
    return stat.isFile() && stat.size > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function readableJson(file: string) {
  if (!(await readableFile(file))) return false
  await readJson(file)
  return true
}

async function pathExists(target: string) {
  try {
    await fs.stat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function randomOperationIDCandidate() {
  const wordCount = randomInt(2, 4)
  const words: string[] = []
  while (words.length < wordCount) {
    const word = operationNameWords[randomInt(operationNameWords.length)]
    if (words.at(-1) !== word) words.push(word)
  }
  const tag = randomUUID().replaceAll("-", "").slice(0, 6)
  return `${words.join("-")}-${tag}`
}

async function resolveOperationID(worktree: string, operationID: string | undefined) {
  const explicit = operationID?.trim()
  if (explicit) return slug(explicit, "operation")

  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = randomOperationIDCandidate()
    if (!(await pathExists(operationPath(worktree, candidate)))) return candidate
  }

  return `${randomOperationIDCandidate()}-${Date.now().toString(36)}`
}

function normalizeDuration(value: number | undefined) {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0) throw new Error("targetDurationHours must be a non-negative number")
  return Math.round(value * 100) / 100
}

function goalMarkdown(goal: OperationGoalRecord) {
  return [
    `# Operation Goal ${goal.operationID}`,
    "",
    `status: ${goal.status}`,
    goal.targetDurationHours === undefined ? undefined : `target_duration_hours: ${goal.targetDurationHours}`,
    "",
    "## Objective",
    "",
    goal.objective,
    "",
    "## Completion Policy",
    "",
    `- requires_operation_audit: ${goal.completionPolicy.requiresOperationAudit}`,
    `- requires_runtime_summary: ${goal.completionPolicy.requiresRuntimeSummary}`,
    `- requires_report_render: ${goal.completionPolicy.requiresReportRender}`,
    `- requires_stage_gate: ${goal.completionPolicy.requiresStageGate ?? "none"}`,
    "",
    "## Continuation",
    "",
    `- enabled: ${goal.continuation.enabled}`,
    `- idle_minutes_before_review: ${goal.continuation.idleMinutesBeforeReview}`,
    `- max_no_tool_continuation_turns: ${goal.continuation.maxNoToolContinuationTurns}`,
    `- turn_end_review: ${goal.continuation.turnEndReview}`,
    `- inject_plan_max_chars: ${goal.continuation.injectPlanMaxChars}`,
    `- operator_fallback_timeout_seconds: ${goal.continuation.operatorFallbackTimeoutSeconds}`,
    `- operator_fallback_enabled: ${goal.continuation.operatorFallbackEnabled}`,
    `- max_repeated_operator_timeouts_per_kind: ${goal.continuation.maxRepeatedOperatorTimeoutsPerKind}`,
    "",
    "## Time",
    "",
    `- created_at: ${goal.createdAt}`,
    `- updated_at: ${goal.updatedAt}`,
    ...(goal.completedAt ? [`- completed_at: ${goal.completedAt}`] : []),
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

async function writeGoal(files: OperationGoalFiles, goal: OperationGoalRecord) {
  await writeJson(files.json, goal)
  await fs.writeFile(files.markdown, goalMarkdown(goal))
}

function withDefaults(input: OperationGoalCreateInput & { operationID: string }, now: string): OperationGoalRecord {
  const objective = input.objective.trim()
  if (!objective) throw new Error("objective is required")
  return {
    operationID: slug(input.operationID, "operation"),
    objective,
    targetDurationHours: normalizeDuration(input.targetDurationHours),
    status: "active",
    completionPolicy: { ...defaultCompletionPolicy, ...input.completionPolicy },
    continuation: { ...defaultContinuation, ...input.continuation },
    createdAt: now,
    updatedAt: now,
  }
}

export async function createOperationGoal(
  worktree: string,
  input: OperationGoalCreateInput,
  options: { now?: string } = {},
): Promise<OperationGoalCreateResult> {
  const operationID = await resolveOperationID(worktree, input.operationID)
  const files = goalFiles(worktree, operationID)
  const existing = await readJson<OperationGoalRecord>(files.json)
  if (existing?.status === "active") return { operationID, created: false, goal: existing, files }
  const goal = withDefaults({ ...input, operationID }, options.now ?? new Date().toISOString())
  await writeGoal(files, goal)
  return { operationID, created: true, goal, files }
}

export async function readOperationGoal(worktree: string, operationID: string): Promise<OperationGoalReadResult> {
  const id = slug(operationID, "operation")
  const files = goalFiles(worktree, id)
  return { operationID: id, goal: await readJson<OperationGoalRecord>(files.json), files }
}

async function completionBlockers(worktree: string, goal: OperationGoalRecord) {
  const root = operationPath(worktree, goal.operationID)
  const blockers: string[] = []
  if (goal.completionPolicy.requiresRuntimeSummary && !(await readableJson(path.join(root, "deliverables", "runtime-summary.json")))) {
    blockers.push("deliverables/runtime-summary.json is missing or invalid")
  }
  if (goal.completionPolicy.requiresReportRender && !(await readableJson(path.join(root, "deliverables", "final", "manifest.json")))) {
    blockers.push("deliverables/final/manifest.json is missing or invalid")
  }
  if (goal.completionPolicy.requiresOperationAudit && !(await readableJson(path.join(root, "deliverables", "operation-audit.json")))) {
    blockers.push("deliverables/operation-audit.json is missing or invalid")
  }
  const stage = goal.completionPolicy.requiresStageGate
  if (stage && !(await readableJson(path.join(root, "deliverables", "stage-gates", `${slug(stage, "stage")}.json`)))) {
    blockers.push(`deliverables/stage-gates/${slug(stage, "stage")}.json is missing or invalid`)
  }
  return blockers
}

export async function completeOperationGoal(
  worktree: string,
  input: OperationGoalCompleteInput,
  options: { now?: string } = {},
): Promise<OperationGoalCompleteResult> {
  const operationID = slug(input.operationID, "operation")
  const files = goalFiles(worktree, operationID)
  const goal = await readJson<OperationGoalRecord>(files.json)
  if (!goal) return { operationID, completed: false, blockers: ["operation goal is missing"], files }
  if (goal.status === "complete") return { operationID, completed: true, blockers: [], goal, files }
  const blockers = await completionBlockers(worktree, goal)
  if (blockers.length) {
    await writeJson(files.blockers, { operationID, checkedAt: options.now ?? new Date().toISOString(), blockers })
    return { operationID, completed: false, blockers, goal, files }
  }
  const now = options.now ?? new Date().toISOString()
  const completed = {
    ...goal,
    status: "complete" as const,
    updatedAt: now,
    completedAt: now,
  }
  await writeGoal(files, completed)
  return { operationID, completed: true, blockers: [], goal: completed, files }
}
