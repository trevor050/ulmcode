import fs from "fs/promises"
import path from "path"
import { Bus } from "@/bus"
import { OperationEvent } from "./event"
import { Schema } from "effect"

export const STAGES = ["intake", "recon", "mapping", "validation", "reporting", "handoff"] as const
export const OPERATION_STATUSES = ["planned", "running", "blocked", "paused", "complete"] as const
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const
export const FINDING_STATES = ["candidate", "needs_validation", "validated", "report_ready", "rejected"] as const
export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const
export const EVIDENCE_KINDS = ["command_output", "http_response", "screenshot", "file", "note", "log"] as const

export type Stage = (typeof STAGES)[number]
export type OperationStatus = (typeof OPERATION_STATUSES)[number]
export type RiskLevel = (typeof RISK_LEVELS)[number]
export type FindingState = (typeof FINDING_STATES)[number]
export type Severity = (typeof SEVERITIES)[number]
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]
type OperationUpdatedArtifact = Schema.Schema.Type<typeof OperationEvent.Updated.properties>["artifact"]

export type EvidenceRef = {
  id: string
  path?: string
  summary?: string
  command?: string
  createdAt?: string
}

async function publishOperationUpdated(
  worktree: string,
  input: { operationID: string; artifact: OperationUpdatedArtifact; path?: string },
) {
  try {
    const status = await readOperationStatus(worktree, input.operationID, { eventLimit: 0 }).catch(() => undefined)
    await Bus.publish(OperationEvent.Updated, {
      ...input,
      operation: status?.operation
        ? {
            objective: status.operation.objective,
            stage: status.operation.stage,
            status: status.operation.status,
            summary: status.operation.summary,
            riskLevel: status.operation.riskLevel,
            nextActions: status.operation.nextActions,
            blockers: status.operation.blockers,
          }
        : undefined,
      findings: status?.findings ? { total: status.findings.total } : undefined,
      evidence: status?.evidence ? { total: status.evidence.total } : undefined,
      reports: status?.reports,
      runtimeSummary: status?.runtimeSummary,
    })
  } catch {}
}

export type OperationCheckpointInput = {
  operationID?: string
  objective: string
  stage: Stage
  status: OperationStatus
  summary: string
  nextActions?: string[]
  blockers?: string[]
  riskLevel?: RiskLevel
  activeTasks?: string[]
  evidence?: EvidenceRef[]
  notes?: string
}

export type OperationRecord = {
  operationID: string
  objective: string
  stage: Stage
  status: OperationStatus
  summary: string
  nextActions: string[]
  blockers: string[]
  riskLevel: RiskLevel
  activeTasks: string[]
  evidence: EvidenceRef[]
  notes?: string
  time: {
    created: string
    updated: string
  }
}

export type FindingInput = {
  operationID: string
  findingID?: string
  title: string
  state: FindingState
  severity: Severity
  confidence: number
  affectedAssets: string[]
  evidence: EvidenceRef[]
  description: string
  impact?: string
  remediation?: string
  sourceTasks?: string[]
}

export type EvidenceInput = {
  operationID: string
  evidenceID?: string
  title: string
  kind: EvidenceKind
  summary: string
  source?: string
  command?: string
  path?: string
  content?: string
}

export type EvidenceRecord = Omit<EvidenceInput, "content"> & {
  evidenceID: string
  path?: string
  time: {
    created: string
    updated: string
  }
}

export type EvidenceWriteResult = {
  operationID: string
  evidenceID: string
  json: string
  rawPath?: string
  record: EvidenceRecord
}

export type FindingRecord = FindingInput & {
  findingID: string
  time: {
    created: string
    updated: string
  }
}

export type ReportLintResult = {
  operationID: string
  ok: boolean
  checkedAt: string
  gaps: string[]
  counts: {
    findings: number
    reportReady: number
    validated: number
    candidates: number
    rejected: number
  }
}

export type ReportOutlineInput = {
  operationID: string
  audience?: "technical" | "executive" | "board" | "mixed"
  targetPages?: number
  includeAppendix?: boolean
}

export type ReportLintOptions = {
  requireReport?: boolean
  minWords?: number
  requireOutlineBudget?: boolean
  minOutlineWordsPerPage?: number
  requireOutlineSections?: boolean
  minOutlineSectionWords?: number
  minOutlineSectionWordsPerPage?: number
  requireFindingSections?: boolean
  minFindingWords?: number
  finalHandoff?: boolean
  requireOperationPlan?: boolean
  requireRenderedDeliverables?: boolean
  requireRuntimeSummary?: boolean
}

export type OperationStatusSummary = {
  operationID: string
  root: string
  operation?: OperationRecord
  plans: {
    operation: boolean
  }
  findings: {
    total: number
    byState: Record<FindingState, number>
    bySeverity: Record<Severity, number>
  }
  evidence: {
    total: number
    byKind: Record<EvidenceKind, number>
  }
  reports: {
    outline: boolean
    markdown: boolean
    html: boolean
    pdf: boolean
    readme: boolean
    manifest: boolean
  }
  runtimeSummary: boolean
  runtime?: {
    generatedAt: string
    modelCalls?: RuntimeSummaryRecord["modelCalls"]
    usage?: RuntimeSummaryRecord["usage"]
    compaction?: RuntimeSummaryRecord["compaction"]
    fetches?: RuntimeSummaryRecord["fetches"]
    backgroundTasks?: RuntimeSummaryRecord["backgroundTasks"]
    notes?: RuntimeSummaryRecord["notes"]
  }
  lastEvents: unknown[]
}

export type OperationResumeBrief = {
  operationID: string
  root: string
  generatedAt: string
  checkpoint?: Pick<
    OperationRecord,
    "objective" | "stage" | "status" | "summary" | "riskLevel" | "nextActions" | "blockers" | "activeTasks" | "time"
  >
  health: {
    ready: boolean
    status: "ready" | "attention_required"
    gaps: string[]
  }
  artifacts: OperationStatusSummary["plans"] & {
    reports: OperationStatusSummary["reports"]
    runtimeSummary: boolean
    findings: OperationStatusSummary["findings"]["total"]
    evidence: OperationStatusSummary["evidence"]["total"]
  }
  runtime?: OperationStatusSummary["runtime"]
  recommendedTools: string[]
  continuationPrompt: string
  lastEvents: unknown[]
}

export type OperationResumeOptions = {
  eventLimit?: number
  staleAfterMinutes?: number
  now?: string
}

export type OperationAuditOptions = OperationResumeOptions & ReportLintOptions

export type OperationAuditResult = {
  operationID: string
  root: string
  generatedAt: string
  ok: boolean
  checks: {
    resume: {
      ok: boolean
      status: OperationResumeBrief["health"]["status"]
      gaps: string[]
    }
    finalHandoff: {
      ok: boolean
      status: "ready" | "attention_required"
      gaps: string[]
      counts: ReportLintResult["counts"]
    }
  }
  blockers: string[]
  recommendedTools: string[]
  files: {
    json: string
    markdown: string
  }
}

export type OperationStageGateOptions = Pick<
  ReportLintOptions,
  | "requireReport"
  | "minWords"
  | "requireOutlineBudget"
  | "minOutlineWordsPerPage"
  | "requireOutlineSections"
  | "minOutlineSectionWords"
  | "minOutlineSectionWordsPerPage"
  | "requireFindingSections"
  | "minFindingWords"
> & {
  stage?: Stage
}

export type OperationStageGateResult = {
  operationID: string
  root: string
  generatedAt: string
  stage: Stage
  ok: boolean
  gaps: string[]
  requiredArtifacts: string[]
  recommendedTools: string[]
  files: {
    json: string
    markdown: string
  }
}

export type ReportRenderInput = {
  operationID: string
  title?: string
}

export type ReportRenderResult = {
  operationID: string
  html: string
  pdf: string
  readme: string
  manifest: string
  finalDir: string
  findings: number
}

export type RuntimeSummaryInput = {
  operationID: string
  sessionMessages?: RuntimeUsageMessage[]
  modelCalls?: {
    total?: number
    byModel?: Record<string, number>
  }
  usage?: {
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    totalTokens?: number
    costUSD?: number
    budgetUSD?: number
    remainingUSD?: number
    byAgent?: Record<
      string,
      {
        calls?: number
        totalTokens?: number
        costUSD?: number
      }
    >
  }
  compaction?: {
    count?: number
    pressure?: "low" | "moderate" | "high" | "critical"
    lastSummary?: string
  }
  fetches?: {
    total?: number
    repeatedTargets?: string[]
  }
  backgroundTasks?: Array<{
    id: string
    agent?: string
    status: "running" | "completed" | "failed" | "cancelled" | "stale" | "unknown"
    summary?: string
    restartArgs?: {
      task_id: string
      background: boolean
      description: string
      prompt: string
      subagent_type: string
      operationID?: string
      command?: string
    }
  }>
  notes?: string[]
}

export type RuntimeUsageMessage = {
  role?: string
  agent?: string
  modelID?: string
  providerID?: string
  summary?: boolean
  cost?: number
  parts?: Array<{
    type?: string
    auto?: boolean
    overflow?: boolean
  }>
  tokens?: {
    total?: number
    input?: number
    output?: number
    reasoning?: number
    cache?: {
      read?: number
      write?: number
    }
  }
}

export type RuntimeSummaryRecord = RuntimeSummaryInput & {
  operationID: string
  generatedAt: string
  operation?: Pick<OperationRecord, "stage" | "status" | "summary" | "nextActions" | "blockers" | "activeTasks">
  artifacts: {
    root: string
    status: string
    events: string
    findings: string
    final: string
  }
}

export type RuntimeSummaryResult = {
  operationID: string
  json: string
  markdown: string
  finalDir: string
}

export type OperationPlanPhase = {
  stage: Stage
  objective: string
  actions: string[]
  successCriteria: string[]
  subagents: string[]
  noSubagents: string[]
}

export type OperationPlanInput = {
  operationID: string
  assumptions?: string[]
  phases: OperationPlanPhase[]
  reportingCloseout: string[]
}

export type OperationPlanRecord = OperationPlanInput & {
  operationID: string
  writtenAt: string
  objective?: string
}

export type OperationPlanResult = {
  operationID: string
  json: string
  markdown: string
  phases: number
}

export function slug(input: string, fallback: string) {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return value || fallback
}

export function operationsRoot(worktree: string) {
  return path.join(worktree, ".ulmcode", "operations")
}

export function operationPath(worktree: string, operationID: string) {
  return path.join(operationsRoot(worktree), slug(operationID, "operation"))
}

export function makeOperationID(input: Pick<OperationCheckpointInput, "operationID" | "objective">) {
  return slug(input.operationID ?? input.objective, `operation-${Date.now()}`)
}

export function makeFindingID(input: Pick<FindingInput, "findingID" | "title">) {
  return slug(input.findingID ?? input.title, `finding-${Date.now()}`)
}

export function makeEvidenceID(input: Pick<EvidenceInput, "evidenceID" | "title">) {
  return slug(input.evidenceID ?? input.title, `evidence-${Date.now()}`)
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function readText(file: string) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n")
}

async function appendJsonl(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(data) + "\n")
}

async function readJsonlTail(file: string, limit: number) {
  try {
    return (await fs.readFile(file, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function roundUsage(value: number) {
  return Number(value.toFixed(6))
}

function derivedTotal(tokens: RuntimeUsageMessage["tokens"]) {
  if (!tokens) return 0
  if (tokens.total !== undefined) return finite(tokens.total)
  return finite(tokens.input) + finite(tokens.output) + finite(tokens.reasoning)
}

export function summarizeRuntimeUsage(messages: RuntimeUsageMessage[]) {
  const modelCalls: NonNullable<RuntimeSummaryInput["modelCalls"]> = { total: 0, byModel: {} }
  const usage: NonNullable<RuntimeSummaryInput["usage"]> = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUSD: 0,
    byAgent: {},
  }

  for (const message of messages) {
    if (message.role !== "assistant") continue
    const model = message.modelID ?? "unknown"
    const agent = message.agent ?? "unknown"
    const tokens = message.tokens
    const totalTokens = derivedTotal(tokens)
    const cost = finite(message.cost)

    modelCalls.total = (modelCalls.total ?? 0) + 1
    modelCalls.byModel![model] = (modelCalls.byModel![model] ?? 0) + 1
    usage.inputTokens = (usage.inputTokens ?? 0) + finite(tokens?.input)
    usage.outputTokens = (usage.outputTokens ?? 0) + finite(tokens?.output)
    usage.reasoningTokens = (usage.reasoningTokens ?? 0) + finite(tokens?.reasoning)
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + finite(tokens?.cache?.read)
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + finite(tokens?.cache?.write)
    usage.totalTokens = (usage.totalTokens ?? 0) + totalTokens
    usage.costUSD = roundUsage((usage.costUSD ?? 0) + cost)

    const agentUsage = usage.byAgent![agent] ?? { calls: 0, totalTokens: 0, costUSD: 0 }
    usage.byAgent![agent] = {
      calls: (agentUsage.calls ?? 0) + 1,
      totalTokens: (agentUsage.totalTokens ?? 0) + totalTokens,
      costUSD: roundUsage((agentUsage.costUSD ?? 0) + cost),
    }
  }

  return { modelCalls, usage }
}

function mergeRuntimeUsage(input: RuntimeSummaryInput) {
  const derived = input.sessionMessages?.length ? summarizeRuntimeUsage(input.sessionMessages) : undefined
  const compaction = input.compaction ?? deriveRuntimeCompaction(input.sessionMessages ?? [])
  if (!derived) {
    const next = { ...input, usage: normalizeRuntimeBudget(input.usage) }
    return compaction ? { ...next, compaction } : next
  }
  const usage = input.usage
    ? {
        ...derived.usage,
        ...input.usage,
        byAgent: {
          ...(derived.usage.byAgent ?? {}),
          ...(input.usage.byAgent ?? {}),
        },
      }
    : derived.usage

  return {
    ...input,
    modelCalls: input.modelCalls ?? derived.modelCalls,
    usage: normalizeRuntimeBudget(usage),
    compaction,
  }
}

function compactionPressure(count: number): "low" | "moderate" | "high" | "critical" {
  if (count >= 8) return "critical"
  if (count >= 4) return "high"
  if (count >= 2) return "moderate"
  return "low"
}

function deriveRuntimeCompaction(messages: RuntimeUsageMessage[]): RuntimeSummaryInput["compaction"] | undefined {
  const count = messages.reduce(
    (total, message) => total + (message.parts ?? []).filter((part) => part.type === "compaction").length,
    0,
  )
  if (!count) return undefined
  return {
    count,
    pressure: compactionPressure(count),
  }
}

function normalizeRuntimeBudget(usage: RuntimeSummaryInput["usage"]) {
  if (!usage) return usage
  if (usage.remainingUSD !== undefined) return usage
  const budgetUSD = usage.budgetUSD
  const costUSD = usage.costUSD
  if (
    budgetUSD === undefined ||
    costUSD === undefined ||
    !Number.isFinite(budgetUSD) ||
    !Number.isFinite(costUSD)
  ) {
    return usage
  }
  return {
    ...usage,
    remainingUSD: roundUsage(budgetUSD - costUSD),
  }
}

function listLines(items: string[] | undefined, empty: string) {
  if (!items?.length) return [`- ${empty}`]
  return items.map((item) => `- ${item}`)
}

function compactRecord(input: Record<string, number> | undefined) {
  return Object.entries(input ?? {})
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")
}

export function formatOperationStatusDashboard(status: OperationStatusSummary) {
  const operation = status.operation
  const modelSplit = compactRecord(status.runtime?.modelCalls?.byModel)
  const stateSplit = compactRecord(status.findings.byState)
  const severitySplit = compactRecord(status.findings.bySeverity)
  const evidenceSplit = compactRecord(status.evidence.byKind)
  const reports = [
    status.plans.operation ? "plan" : undefined,
    status.reports.outline ? "outline" : undefined,
    status.reports.markdown ? "report.md" : undefined,
    status.reports.html ? "html" : undefined,
    status.reports.pdf ? "pdf" : undefined,
    status.reports.readme ? "readme" : undefined,
    status.reports.manifest ? "manifest" : undefined,
    status.runtimeSummary ? "runtime" : undefined,
  ].filter((item): item is string => !!item)
  const background = status.runtime?.backgroundTasks ?? []
  const runtimeNotes = status.runtime?.notes ?? []
  return [
    `# ${status.operationID} - ${operation?.stage ?? "unknown"}/${operation?.status ?? "unknown"}`,
    "",
    `root: ${status.root}`,
    `risk: ${operation?.riskLevel ?? "unknown"}`,
    `summary: ${operation?.summary ?? "No checkpoint recorded."}`,
    "",
    `findings: ${status.findings.total} total${stateSplit ? ` (${stateSplit})` : ""}${
      severitySplit ? `; severity ${severitySplit}` : ""
    }`,
    `evidence: ${status.evidence.total} total${evidenceSplit ? ` (${evidenceSplit})` : ""}`,
    `reports: ${reports.length ? reports.join(", ") : "none"}`,
    `runtime: ${status.runtime?.modelCalls?.total ?? 0} calls, ${status.runtime?.usage?.totalTokens ?? 0} tokens, $${
      status.runtime?.usage?.costUSD ?? 0
    }${status.runtime?.usage?.remainingUSD !== undefined ? `, $${status.runtime.usage.remainingUSD} remaining` : ""}`,
    `models: ${modelSplit || "none recorded"}`,
    "",
    "next_actions:",
    ...listLines(operation?.nextActions, "none recorded"),
    "",
    "blockers:",
    ...listLines(operation?.blockers, "none recorded"),
    "",
    "active_tasks:",
    ...listLines(operation?.activeTasks, "none recorded"),
    "",
    "background:",
    ...(background.length
      ? background.map(
          (task) =>
            `- ${task.id} ${task.status}${task.agent ? ` (${task.agent})` : ""}${
              task.summary ? ` - ${task.summary}` : ""
            }${task.restartArgs ? `; restart_args: ${JSON.stringify(task.restartArgs)}` : ""}`,
        )
      : ["- none recorded"]),
    "",
    "runtime_notes:",
    ...listLines(runtimeNotes, "none recorded"),
    "",
  ].join("\n")
}

function unique(items: string[]) {
  return [...new Set(items)]
}

function minutesSince(value: string | undefined, now: Date) {
  if (!value) return undefined
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return undefined
  return Math.max(0, Math.floor((now.getTime() - time) / 60_000))
}

function runtimeHealthGaps(status: OperationStatusSummary) {
  const gaps: string[] = []
  const usage = status.runtime?.usage
  const costUSD = usage?.costUSD
  const budgetUSD = usage?.budgetUSD
  const remainingUSD = usage?.remainingUSD
  if (
    budgetUSD !== undefined &&
    costUSD !== undefined &&
    Number.isFinite(budgetUSD) &&
    Number.isFinite(costUSD) &&
    (remainingUSD !== undefined && Number.isFinite(remainingUSD) ? remainingUSD <= 0 : costUSD >= budgetUSD)
  ) {
    gaps.push(`runtime budget exhausted: spent $${costUSD} of $${budgetUSD}`)
  }
  for (const note of status.runtime?.notes ?? []) {
    if (note.startsWith("runtime blind spot:")) {
      gaps.push(`runtime usage blind spot recorded: ${note}`)
    }
  }
  return gaps
}

function resumeGaps(status: OperationStatusSummary, options: OperationResumeOptions = {}) {
  const gaps: string[] = []
  const operation = status.operation
  const staleAfter = options.staleAfterMinutes
  const now = new Date(options.now ?? Date.now())
  if (!operation) gaps.push("operation checkpoint is missing")
  if (!status.plans.operation) gaps.push("operation plan is missing")
  if (!status.runtimeSummary) gaps.push("runtime summary is missing")
  gaps.push(...runtimeHealthGaps(status))
  if (operation?.status === "running" && staleAfter !== undefined) {
    const age = minutesSince(operation.time.updated, now)
    if (age !== undefined && age >= staleAfter) {
      gaps.push(`operation checkpoint is stale: last update was ${age} minutes ago`)
    }
  }
  if (operation?.status === "running" && operation.nextActions.length === 0) {
    gaps.push("running operation has no next actions")
  }
  if (operation?.status === "blocked" && operation.blockers.length === 0) {
    gaps.push("blocked operation has no blockers recorded")
  }
  if (
    operation?.stage === "handoff" &&
    operation.status === "complete" &&
    (!status.reports.html || !status.reports.pdf || !status.reports.manifest || !status.reports.readme)
  ) {
    gaps.push("complete handoff is missing final deliverables")
  }
  for (const task of status.runtime?.backgroundTasks ?? []) {
    if (task.status === "stale") gaps.push(`background task ${task.id} is stale`)
  }
  return gaps
}

function resumeToolRecommendations(status: OperationStatusSummary, gaps: string[]) {
  const operation = status.operation
  const background = status.runtime?.backgroundTasks ?? []
  const tools = ["operation_status"]
  if (gaps.includes("operation plan is missing")) tools.push("operation_plan")
  if (
    gaps.includes("runtime summary is missing") ||
    gaps.some((gap) => gap.startsWith("runtime budget exhausted")) ||
    gaps.some((gap) => gap.startsWith("runtime usage blind spot recorded"))
  ) {
    tools.push("runtime_summary")
  }
  if (gaps.some((gap) => gap.startsWith("operation checkpoint is stale"))) tools.push("operation_checkpoint")
  if (operation?.activeTasks.length || background.length) tools.push("task_list", "task_status")
  if (background.some((task) => task.status === "stale" && task.restartArgs)) {
    tools.push("operation_resume", "operation_recover", "task_restart")
  }
  if (operation?.stage === "validation") tools.push("evidence_record", "finding_record")
  if (operation?.stage === "reporting" || operation?.stage === "handoff") tools.push("report_lint")
  if (operation?.stage === "handoff" && (!status.reports.html || !status.reports.pdf)) tools.push("report_render")
  return unique(tools)
}

function resumeContinuationPrompt(status: OperationStatusSummary, recommendedTools: string[]) {
  const operation = status.operation
  const hasRestartableStaleTasks = (status.runtime?.backgroundTasks ?? []).some(
    (task) => task.status === "stale" && task.restartArgs,
  )
  const recovery = hasRestartableStaleTasks
    ? ` Restart restartable stale lanes first with operation_resume operationID=${status.operationID} recoverStaleTasks=true or operation_recover operationID=${status.operationID}; do not launch duplicate replacement lanes until recovery is checked.`
    : ""
  if (!operation) {
    return `Resume ULMCode operation ${status.operationID}. First recreate or inspect the missing operation checkpoint, then use ${recommendedTools.join(
      ", ",
    )}.${recovery}`
  }
  const nextActions = operation.nextActions.length ? operation.nextActions.join("; ") : "no next actions recorded"
  const blockers = operation.blockers.length ? ` Blockers: ${operation.blockers.join("; ")}.` : ""
  return `Resume ULMCode operation ${status.operationID} from ${operation.stage}/${operation.status}. First use ${recommendedTools[0]} to refresh disk state, then continue: ${nextActions}.${recovery}${blockers}`
}

export async function buildOperationResumeBrief(
  worktree: string,
  operationID: string,
  options: OperationResumeOptions = {},
): Promise<OperationResumeBrief> {
  const status = await readOperationStatus(worktree, operationID, { eventLimit: options.eventLimit ?? 10 })
  const gaps = resumeGaps(status, options)
  const recommendedTools = resumeToolRecommendations(status, gaps)
  return {
    operationID: status.operationID,
    root: status.root,
    generatedAt: new Date().toISOString(),
    checkpoint: status.operation
      ? {
          objective: status.operation.objective,
          stage: status.operation.stage,
          status: status.operation.status,
          summary: status.operation.summary,
          riskLevel: status.operation.riskLevel,
          nextActions: status.operation.nextActions,
          blockers: status.operation.blockers,
          activeTasks: status.operation.activeTasks,
          time: status.operation.time,
        }
      : undefined,
    health: {
      ready: gaps.length === 0,
      status: gaps.length === 0 ? "ready" : "attention_required",
      gaps,
    },
    artifacts: {
      ...status.plans,
      reports: status.reports,
      runtimeSummary: status.runtimeSummary,
      findings: status.findings.total,
      evidence: status.evidence.total,
    },
    runtime: status.runtime,
    recommendedTools,
    continuationPrompt: resumeContinuationPrompt(status, recommendedTools),
    lastEvents: status.lastEvents,
  }
}

export function formatOperationResumeBrief(brief: OperationResumeBrief) {
  const checkpoint = brief.checkpoint
  const background = brief.runtime?.backgroundTasks ?? []
  const toolHints = [
    brief.recommendedTools.includes("operation_status") ? `operation_status operationID=${brief.operationID}` : undefined,
    brief.recommendedTools.includes("operation_resume")
      ? `operation_resume operationID=${brief.operationID} recoverStaleTasks=true`
      : undefined,
    brief.recommendedTools.includes("operation_recover") ? `operation_recover operationID=${brief.operationID}` : undefined,
    brief.recommendedTools.includes("task_list") ? `task_list operationID=${brief.operationID}` : undefined,
    ...background.map((task) => `task_status task_id=${task.id}`),
    ...background
      .filter((task) => task.status === "stale" && task.restartArgs)
      .map((task) => `task_restart task_id=${task.id}`),
  ].filter((item): item is string => item !== undefined)
  return [
    `# Resume ${brief.operationID}`,
    "",
    `health: ${brief.health.status}`,
    `root: ${brief.root}`,
    `stage: ${checkpoint?.stage ?? "unknown"}`,
    `status: ${checkpoint?.status ?? "unknown"}`,
    `risk: ${checkpoint?.riskLevel ?? "unknown"}`,
    `summary: ${checkpoint?.summary ?? "No checkpoint recorded."}`,
    checkpoint?.time.updated ? `updated: ${checkpoint.time.updated}` : undefined,
    "",
    "gaps:",
    ...listLines(brief.health.gaps, "none"),
    "",
    "recommended_tools:",
    ...listLines(brief.recommendedTools, "none"),
    "",
    "tool_hints:",
    ...listLines(toolHints, "none"),
    "",
    "next_actions:",
    ...listLines(checkpoint?.nextActions, "none recorded"),
    "",
    "blockers:",
    ...listLines(checkpoint?.blockers, "none recorded"),
    "",
    "active_tasks:",
    ...listLines(checkpoint?.activeTasks, "none recorded"),
    "",
    "background:",
    ...(background.length
      ? background.map(
          (task) =>
            `- ${task.id} ${task.status}${task.agent ? ` (${task.agent})` : ""}${
              task.summary ? ` - ${task.summary}` : ""
            }${task.restartArgs ? `; restart_args: ${JSON.stringify(task.restartArgs)}` : ""}`,
        )
      : ["- none recorded"]),
    "",
    "continuation_prompt:",
    brief.continuationPrompt,
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

function statusMarkdown(record: OperationRecord) {
  return [
    `# ${record.operationID}`,
    "",
    `- objective: ${record.objective}`,
    `- stage: ${record.stage}`,
    `- status: ${record.status}`,
    `- risk: ${record.riskLevel}`,
    `- updated: ${record.time.updated}`,
    "",
    "## Summary",
    record.summary,
    "",
    "## Next Actions",
    ...(record.nextActions.length ? record.nextActions.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    "## Blockers",
    ...(record.blockers.length ? record.blockers.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    "## Active Tasks",
    ...(record.activeTasks.length ? record.activeTasks.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    "## Evidence",
    ...(record.evidence.length
      ? record.evidence.map((item) => `- ${item.id}${item.path ? ` (${item.path})` : ""}: ${item.summary ?? ""}`)
      : ["- none recorded"]),
    "",
  ].join("\n")
}

function lintToolRecommendations(gaps: string[]) {
  const tools = ["report_lint"]
  if (gaps.some((gap) => gap.includes("plans/operation-plan.json") || gap.includes("operation plan"))) {
    tools.push("operation_plan")
  }
  if (gaps.some((gap) => gap.includes("deliverables/final/") || gap.includes("report is required"))) {
    tools.push("report_render")
  }
  if (gaps.some((gap) => gap.includes("runtime-summary.json"))) {
    tools.push("runtime_summary")
  }
  if (gaps.some((gap) => gap.includes("finding") || gap.includes("findings"))) {
    tools.push("finding_record")
  }
  if (gaps.some((gap) => gap.includes("evidence"))) {
    tools.push("evidence_record")
  }
  if (
    gaps.some(
      (gap) =>
        gap.includes("outline budget") || gap.includes("report-outline.md") || gap.includes("outline section"),
    )
  ) {
    tools.push("report_outline")
  }
  return tools
}

export function formatOperationAudit(audit: OperationAuditResult) {
  return [
    `# Operation Audit ${audit.operationID}`,
    "",
    `status: ${audit.ok ? "ready" : "attention_required"}`,
    `root: ${audit.root}`,
    `generated_at: ${audit.generatedAt}`,
    "",
    `resume: ${audit.checks.resume.status}`,
    ...listLines(audit.checks.resume.gaps, "none"),
    "",
    `final_handoff: ${audit.checks.finalHandoff.status}`,
    ...listLines(audit.checks.finalHandoff.gaps, "none"),
    "",
    "blockers:",
    ...listLines(audit.blockers, "none"),
    "",
    "recommended_tools:",
    ...listLines(audit.recommendedTools, "none"),
    "",
  ].join("\n")
}

export async function buildOperationAudit(
  worktree: string,
  operationID: string,
  options: OperationAuditOptions = {},
): Promise<OperationAuditResult> {
  const resume = await buildOperationResumeBrief(worktree, operationID, {
    eventLimit: options.eventLimit,
    staleAfterMinutes: options.staleAfterMinutes,
    now: options.now,
  })
  const finalHandoff = await lintReport(worktree, operationID, {
    requireReport: options.requireReport,
    minWords: options.minWords,
    requireOutlineBudget: options.requireOutlineBudget,
    minOutlineWordsPerPage: options.minOutlineWordsPerPage,
    requireOutlineSections: options.requireOutlineSections,
    minOutlineSectionWords: options.minOutlineSectionWords,
    minOutlineSectionWordsPerPage: options.minOutlineSectionWordsPerPage,
    requireFindingSections: options.requireFindingSections,
    minFindingWords: options.minFindingWords,
    finalHandoff: options.finalHandoff ?? true,
    requireOperationPlan: options.requireOperationPlan,
    requireRenderedDeliverables: options.requireRenderedDeliverables,
    requireRuntimeSummary: options.requireRuntimeSummary,
  })
  const root = operationPath(worktree, operationID)
  const generatedAt = new Date().toISOString()
  const files = {
    json: path.join(root, "deliverables", "operation-audit.json"),
    markdown: path.join(root, "deliverables", "operation-audit.md"),
  }
  const audit: OperationAuditResult = {
    operationID: slug(operationID, "operation"),
    root,
    generatedAt,
    ok: resume.health.ready && finalHandoff.ok,
    checks: {
      resume: {
        ok: resume.health.ready,
        status: resume.health.status,
        gaps: resume.health.gaps,
      },
      finalHandoff: {
        ok: finalHandoff.ok,
        status: finalHandoff.ok ? "ready" : "attention_required",
        gaps: finalHandoff.gaps,
        counts: finalHandoff.counts,
      },
    },
    blockers: [
      ...resume.health.gaps.map((gap) => `resume: ${gap}`),
      ...finalHandoff.gaps.map((gap) => `final_handoff: ${gap}`),
    ],
    recommendedTools: unique([...resume.recommendedTools, ...lintToolRecommendations(finalHandoff.gaps)]),
    files,
  }
  await fs.mkdir(path.dirname(files.json), { recursive: true })
  await writeJson(files.json, audit)
  await fs.writeFile(files.markdown, formatOperationAudit(audit))
  await publishOperationUpdated(worktree, { operationID: audit.operationID, artifact: "operation_audit", path: files.json })
  return audit
}

function stageRequiredArtifacts(stage: Stage) {
  const common = ["operation.json", "plans/operation-plan.json"]
  if (stage === "intake") return common
  if (stage === "recon") return [...common, "evidence/"]
  if (stage === "mapping") return [...common, "evidence/", "findings/"]
  if (stage === "validation") return [...common, "evidence/", "findings/"]
  if (stage === "reporting") return [...common, "findings/", "reports/report-outline.md", "reports/report.md or report.html"]
  return [...common, "deliverables/final/", "deliverables/runtime-summary.json", "deliverables/operation-audit.json"]
}

function stageGateToolRecommendations(stage: Stage, gaps: string[]) {
  const tools = ["operation_status"]
  if (gaps.some((gap) => gap.includes("checkpoint"))) tools.push("operation_checkpoint")
  if (gaps.some((gap) => gap.includes("plan"))) tools.push("operation_plan")
  if (gaps.some((gap) => gap.includes("evidence"))) tools.push("evidence_record")
  if (gaps.some((gap) => gap.includes("finding") || gap.includes("findings"))) tools.push("finding_record")
  if (gaps.some((gap) => gap.includes("outline"))) tools.push("report_outline")
  if (gaps.some((gap) => gap.includes("draft report") || gap.includes("report section"))) tools.push("report_lint")
  if (gaps.some((gap) => gap.includes("deliverables/final"))) tools.push("report_render")
  if (
    gaps.some(
      (gap) =>
        gap.includes("runtime-summary") ||
        gap.startsWith("runtime budget exhausted") ||
        gap.startsWith("runtime usage blind spot recorded"),
    )
  ) {
    tools.push("runtime_summary")
  }
  if (stage === "handoff") tools.push("operation_audit")
  return unique(tools)
}

async function stageGateGaps(
  worktree: string,
  status: OperationStatusSummary,
  stage: Stage,
  options: OperationStageGateOptions = {},
) {
  const gaps: string[] = []
  const reportableFindings = status.findings.byState.validated + status.findings.byState.report_ready
  const unresolvedFindings = status.findings.byState.candidate + status.findings.byState.needs_validation
  if (!status.operation) gaps.push("operation checkpoint is missing")
  if (!status.plans.operation) gaps.push("operation plan is missing")
  if (status.operation?.status === "blocked") {
    gaps.push(
      status.operation.blockers.length
        ? `operation is blocked: ${status.operation.blockers.join("; ")}`
        : "operation is blocked without recorded blockers",
    )
  }
  gaps.push(...runtimeHealthGaps(status))
  if (stage === "recon" && status.evidence.total === 0) gaps.push("recon has no recorded evidence")
  if (stage === "mapping") {
    if (status.evidence.total === 0) gaps.push("mapping has no recorded evidence")
    if (status.findings.total === 0) gaps.push("mapping has no candidate findings")
  }
  if (stage === "validation") {
    if (status.evidence.total === 0) gaps.push("validation has no recorded evidence")
    if (reportableFindings === 0) gaps.push("validation has no validated or report-ready findings")
    if (unresolvedFindings > 0) gaps.push("validation has unresolved candidate or needs-validation findings")
  }
  if (stage === "reporting") {
    if (reportableFindings === 0) gaps.push("reporting has no validated or report-ready findings")
    if (unresolvedFindings > 0) gaps.push("reporting has unresolved candidate or needs-validation findings")
    if (!status.reports.outline) gaps.push("reporting is missing report outline")
    if (!status.reports.markdown && !status.reports.html) gaps.push("reporting has no draft report")
  }
  if (stage === "handoff") {
    const finalHandoff = await lintReport(worktree, status.operationID, {
      requireReport: options.requireReport,
      minWords: options.minWords,
      requireOutlineBudget: options.requireOutlineBudget,
      minOutlineWordsPerPage: options.minOutlineWordsPerPage,
      requireOutlineSections: options.requireOutlineSections,
      minOutlineSectionWords: options.minOutlineSectionWords,
      minOutlineSectionWordsPerPage: options.minOutlineSectionWordsPerPage,
      requireFindingSections: options.requireFindingSections,
      minFindingWords: options.minFindingWords,
      finalHandoff: true,
    })
    gaps.push(...finalHandoff.gaps)
  }
  return gaps
}

export function formatOperationStageGate(gate: OperationStageGateResult) {
  return [
    `# Stage Gate ${gate.operationID}/${gate.stage}`,
    "",
    `status: ${gate.ok ? "ready" : "attention_required"}`,
    `root: ${gate.root}`,
    `generated_at: ${gate.generatedAt}`,
    "",
    "required_artifacts:",
    ...listLines(gate.requiredArtifacts, "none"),
    "",
    "gaps:",
    ...listLines(gate.gaps, "none"),
    "",
    "recommended_tools:",
    ...listLines(gate.recommendedTools, "none"),
    "",
  ].join("\n")
}

export async function buildOperationStageGate(
  worktree: string,
  operationID: string,
  options: OperationStageGateOptions = {},
): Promise<OperationStageGateResult> {
  const status = await readOperationStatus(worktree, operationID)
  const stage = options.stage ?? status.operation?.stage ?? "intake"
  const root = operationPath(worktree, operationID)
  const gaps = await stageGateGaps(worktree, status, stage, options)
  const files = {
    json: path.join(root, "deliverables", "stage-gates", `${stage}.json`),
    markdown: path.join(root, "deliverables", "stage-gates", `${stage}.md`),
  }
  const gate: OperationStageGateResult = {
    operationID: slug(operationID, "operation"),
    root,
    generatedAt: new Date().toISOString(),
    stage,
    ok: gaps.length === 0,
    gaps,
    requiredArtifacts: stageRequiredArtifacts(stage),
    recommendedTools: stageGateToolRecommendations(stage, gaps),
    files,
  }
  await fs.mkdir(path.dirname(files.json), { recursive: true })
  await writeJson(files.json, gate)
  await fs.writeFile(files.markdown, formatOperationStageGate(gate))
  await publishOperationUpdated(worktree, { operationID: gate.operationID, artifact: "stage_gate", path: files.json })
  return gate
}

function runtimeSummaryMarkdown(record: RuntimeSummaryRecord) {
  const byModel = Object.entries(record.modelCalls?.byModel ?? {})
  const byAgent = Object.entries(record.usage?.byAgent ?? {})
  const tasks = record.backgroundTasks ?? []
  return [
    `# Runtime Summary: ${record.operationID}`,
    "",
    `- generated: ${record.generatedAt}`,
    `- stage: ${record.operation?.stage ?? "unknown"}`,
    `- status: ${record.operation?.status ?? "unknown"}`,
    `- model_calls_total: ${record.modelCalls?.total ?? 0}`,
    `- tokens_total: ${record.usage?.totalTokens ?? 0}`,
    `- cost_usd: ${record.usage?.costUSD ?? 0}`,
    `- budget_usd: ${record.usage?.budgetUSD ?? "not set"}`,
    `- remaining_usd: ${record.usage?.remainingUSD ?? "not set"}`,
    `- compactions: ${record.compaction?.count ?? 0}`,
    `- compaction_pressure: ${record.compaction?.pressure ?? "low"}`,
    `- fetches_total: ${record.fetches?.total ?? 0}`,
    "",
    "## Current Summary",
    record.operation?.summary ?? "No operation summary recorded.",
    "",
    "## Next Actions",
    ...(record.operation?.nextActions?.length
      ? record.operation.nextActions.map((item) => `- ${item}`)
      : ["- none recorded"]),
    "",
    "## Blockers",
    ...(record.operation?.blockers?.length
      ? record.operation.blockers.map((item) => `- ${item}`)
      : ["- none recorded"]),
    "",
    "## Background Tasks",
    ...(tasks.length
      ? tasks.map(
          (task) =>
            `- ${task.id}: ${task.status}${task.agent ? ` (${task.agent})` : ""} - ${task.summary ?? ""}${
              task.restartArgs ? `; restart_args: ${JSON.stringify(task.restartArgs)}` : ""
            }`,
        )
      : ["- none recorded"]),
    "",
    "## Model Split",
    ...(byModel.length ? byModel.map(([model, count]) => `- ${model}: ${count}`) : ["- none recorded"]),
    "",
    "## Token And Cost Split",
    `- input_tokens: ${record.usage?.inputTokens ?? 0}`,
    `- output_tokens: ${record.usage?.outputTokens ?? 0}`,
    `- reasoning_tokens: ${record.usage?.reasoningTokens ?? 0}`,
    `- cache_read_tokens: ${record.usage?.cacheReadTokens ?? 0}`,
    `- cache_write_tokens: ${record.usage?.cacheWriteTokens ?? 0}`,
    ...(byAgent.length
      ? byAgent.map(
          ([agent, usage]) =>
            `- ${agent}: ${usage.calls ?? 0} calls, ${usage.totalTokens ?? 0} tokens, $${usage.costUSD ?? 0}`,
        )
      : ["- agent split: none recorded"]),
    "",
    "## Repeated Fetch Targets",
    ...(record.fetches?.repeatedTargets?.length
      ? record.fetches.repeatedTargets.map((target) => `- ${target}`)
      : ["- none recorded"]),
    "",
    "## Notes",
    ...(record.notes?.length ? record.notes.map((note) => `- ${note}`) : ["- none recorded"]),
    "",
    "## Artifact Paths",
    `- status: ${record.artifacts.status}`,
    `- events: ${record.artifacts.events}`,
    `- findings: ${record.artifacts.findings}`,
    `- final: ${record.artifacts.final}`,
    "",
  ].join("\n")
}

function operationPlanMarkdown(record: OperationPlanRecord) {
  return [
    `# Operation Plan: ${record.operationID}`,
    "",
    `- written: ${record.writtenAt}`,
    `- objective: ${record.objective ?? "unknown"}`,
    "",
    "## Assumptions",
    ...(record.assumptions?.length ? record.assumptions.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    "## Execution Order",
    ...record.phases.flatMap((phase, index) => [
      "",
      `### ${index + 1}. ${phase.stage}`,
      "",
      phase.objective,
      "",
      "Actions:",
      ...phase.actions.map((item) => `- ${item}`),
      "",
      "Success Criteria:",
      ...phase.successCriteria.map((item) => `- ${item}`),
      "",
      "Subagents:",
      ...(phase.subagents.length ? phase.subagents.map((item) => `- ${item}`) : ["- none"]),
      "",
      "No Subagents:",
      ...(phase.noSubagents.length ? phase.noSubagents.map((item) => `- ${item}`) : ["- none recorded"]),
    ]),
    "",
    "## Reporting Closeout",
    ...record.reportingCloseout.map((item) => `- ${item}`),
    "",
  ].join("\n")
}

export function validateOperationPlan(input: OperationPlanInput) {
  const gaps: string[] = []
  if (input.phases.length === 0) gaps.push("operation plan requires at least one phase")
  input.phases.forEach((phase, index) => {
    const label = `phase ${index + 1}`
    if (phase.actions.length === 0) gaps.push(`${label} requires at least one action`)
    if (phase.successCriteria.length === 0) gaps.push(`${label} requires at least one success criterion`)
    if (phase.subagents.length === 0 && phase.noSubagents.length === 0) {
      gaps.push(`${label} must state subagent use or no-subagent policy`)
    }
  })
  const closeout = input.reportingCloseout.join("\n")
  if (!closeout) gaps.push("operation plan requires reporting closeout steps")
  for (const required of ["report_lint", "report_render", "runtime_summary"]) {
    if (!closeout.includes(required)) gaps.push(`reporting closeout must include ${required}`)
  }
  return gaps
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function pdfText(input: string) {
  return input.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?")
}

function escapePdfString(input: string) {
  return pdfText(input).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")
}

function wrapPdfLine(input: string, width = 86) {
  const words = pdfText(input).trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= width) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  return lines.length ? lines : [""]
}

function decodeHtmlText(input: string) {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

function htmlToPdfLines(input: string) {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(input)?.[1] ?? input
  return decodeHtmlText(
    body
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<\/(h1|h2|h3|p|tr|table|section)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " "),
  )
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+\|\s*$/g, ""))
    .filter(Boolean)
}

function findingCounts(findings: FindingRecord[]) {
  return Object.fromEntries(FINDING_STATES.map((state) => [state, findings.filter((item) => item.state === state).length])) as Record<
    FindingState,
    number
  >
}

function buildPdf(input: {
  title: string
  operationID: string
  operation?: OperationRecord
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
  reportHtml?: string
}) {
  const sourceLines = input.reportHtml
    ? htmlToPdfLines(input.reportHtml)
    : [
        input.title,
        `Operation: ${input.operationID}`,
        `Stage: ${input.operation?.stage ?? "unknown"} | Status: ${input.operation?.status ?? "unknown"}`,
        "",
        "Executive Summary",
        input.operation?.summary ?? "No operation summary has been recorded.",
        "",
        "Scope And Methodology",
        input.operation?.objective ?? "No objective has been recorded.",
        "",
        "Findings",
        ...(input.reportable.length
          ? input.reportable.flatMap((finding) => [
              `${finding.severity.toUpperCase()}: ${finding.title}`,
              `ID: ${finding.findingID} | State: ${finding.state} | Confidence: ${finding.confidence}`,
              `Affected Assets: ${finding.affectedAssets.join(", ")}`,
              `Description: ${finding.description}`,
              `Impact: ${finding.impact ?? "Not recorded."}`,
              `Remediation: ${finding.remediation ?? "Not recorded."}`,
              `Evidence: ${finding.evidence.map((item) => item.path ?? item.id).join(", ")}`,
              "",
            ])
          : ["No validated or report-ready findings were recorded."]),
        "",
        "Evidence Index",
        ...(input.evidence.length
          ? input.evidence.flatMap((item) => [
              `${item.evidenceID}: ${item.title}`,
              `Kind: ${item.kind} | Path: ${item.path ?? "not recorded"}`,
              `Summary: ${item.summary}`,
              "",
            ])
          : ["No evidence records were recorded."]),
        "",
        "Non-Reportable Findings",
        ...(input.nonReportable.length
          ? input.nonReportable.flatMap((finding) => [
              `${finding.findingID}: ${finding.title}`,
              `State: ${finding.state} | Severity: ${finding.severity} | Confidence: ${finding.confidence}`,
              `Reason retained: not promoted to validated/report-ready state at handoff.`,
              "",
            ])
          : ["No rejected, candidate, or needs-validation findings were recorded."]),
      ]
  const lines = sourceLines.flatMap((line) => wrapPdfLine(line))

  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / 44)) }, (_, index) =>
    lines.slice(index * 44, index * 44 + 44),
  )
  const pageIDs = pages.map((_, index) => 4 + index * 2)
  const contentIDs = pages.map((_, index) => 5 + index * 2)
  const objects: string[] = []
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"
  objects[2] = `<< /Type /Pages /Kids [${pageIDs.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

  for (let index = 0; index < pages.length; index++) {
    const pageID = pageIDs[index]!
    const contentID = contentIDs[index]!
    const content = [
      "BT",
      "/F1 10 Tf",
      "14 TL",
      "72 740 Td",
      ...pages[index]!.flatMap((line) => (line ? [`(${escapePdfString(line)}) Tj`, "T*"] : ["T*"])),
      "ET",
    ].join("\n")
    objects[pageID] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentID} 0 R >>`
    objects[contentID] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  }

  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf)
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

function finalReadme(input: {
  title: string
  operationID: string
  operation?: OperationRecord
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
}) {
  return [
    `# ${input.title}`,
    "",
    `Operation: ${input.operationID}`,
    `Stage: ${input.operation?.stage ?? "unknown"}`,
    `Status: ${input.operation?.status ?? "unknown"}`,
    "",
    "## Files",
    "",
    "- `report.html`: browser-readable final report.",
    "- `report.pdf`: print-ready PDF report.",
    "- `manifest.json`: machine-readable artifact map and counts.",
    "- `README.md`: this handoff note.",
    "",
    "## Findings",
    "",
    ...(input.reportable.length
      ? input.reportable.map((finding) => `- ${finding.findingID}: ${finding.title} (${finding.severity})`)
      : ["- No validated or report-ready findings were recorded."]),
    "",
    "## Evidence",
    "",
    ...(input.evidence.length
      ? input.evidence.map((item) => `- ${item.evidenceID}: ${item.title}${item.path ? ` (${item.path})` : ""}`)
      : ["- No evidence records were recorded."]),
    "",
    "## Non-Reportable Findings",
    "",
    ...(input.nonReportable.length
      ? input.nonReportable.map((finding) => `- ${finding.findingID}: ${finding.title} (${finding.state})`)
      : ["- No rejected, candidate, or needs-validation findings were recorded."]),
    "",
    "## Source Artifacts",
    "",
    "See the parent operation folder for status, plans, evidence records, report outline, and runtime summary.",
    "",
  ].join("\n")
}

export async function writeOperationCheckpoint(worktree: string, input: OperationCheckpointInput) {
  const now = new Date().toISOString()
  const operationID = makeOperationID(input)
  const root = operationPath(worktree, operationID)
  const current = await readJson<OperationRecord>(path.join(root, "operation.json"))
  const record: OperationRecord = {
    operationID,
    objective: input.objective,
    stage: input.stage,
    status: input.status,
    summary: input.summary,
    nextActions: input.nextActions ?? [],
    blockers: input.blockers ?? [],
    riskLevel: input.riskLevel ?? "medium",
    activeTasks: input.activeTasks ?? [],
    evidence: input.evidence ?? [],
    notes: input.notes,
    time: {
      created: current?.time.created ?? now,
      updated: now,
    },
  }
  await writeJson(path.join(root, "operation.json"), record)
  await appendJsonl(path.join(root, "events.jsonl"), { type: "checkpoint", ...record })
  await fs.writeFile(path.join(root, "status.md"), statusMarkdown(record))
  await fs.mkdir(path.join(root, "evidence"), { recursive: true })
  await fs.mkdir(path.join(root, "findings"), { recursive: true })
  await fs.mkdir(path.join(root, "reports"), { recursive: true })
  await publishOperationUpdated(worktree, { operationID, artifact: "checkpoint", path: path.join(root, "operation.json") })
  return { root, record }
}

export function validateFinding(input: FindingInput) {
  const gaps: string[] = []
  if (input.confidence < 0 || input.confidence > 1) gaps.push("confidence must be between 0 and 1")
  if (!input.affectedAssets.length) gaps.push("affectedAssets must contain at least one asset")
  if (["validated", "report_ready"].includes(input.state) && input.evidence.length === 0) {
    gaps.push(`${input.state} findings require at least one evidence reference`)
  }
  if (input.state === "report_ready" && !input.impact) gaps.push("report_ready findings require impact")
  if (input.state === "report_ready" && !input.remediation) gaps.push("report_ready findings require remediation")
  return gaps
}

export async function writeFinding(worktree: string, input: FindingInput) {
  const gaps = validateFinding(input)
  if (gaps.length) throw new Error(gaps.join("; "))

  const now = new Date().toISOString()
  const root = operationPath(worktree, input.operationID)
  const findingID = makeFindingID(input)
  const file = path.join(root, "findings", `${findingID}.json`)
  const current = await readJson<FindingRecord>(file)
  const record: FindingRecord = {
    ...input,
    findingID,
    time: {
      created: current?.time.created ?? now,
      updated: now,
    },
  }
  await writeJson(file, record)
  await appendJsonl(path.join(root, "findings.jsonl"), { type: "finding", ...record })
  await publishOperationUpdated(worktree, { operationID: input.operationID, artifact: "finding", path: file })
  return { root, record }
}

async function readFindings(root: string) {
  let findings: FindingRecord[] = []
  try {
    const files = await fs.readdir(path.join(root, "findings"))
    findings = (
      await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map((file) => readJson<FindingRecord>(path.join(root, "findings", file))),
      )
    ).filter((item): item is FindingRecord => Boolean(item))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return findings
}

async function readEvidenceRecords(root: string) {
  let records: EvidenceRecord[] = []
  try {
    const files = await fs.readdir(path.join(root, "evidence"))
    records = (
      await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map((file) => readJson<EvidenceRecord>(path.join(root, "evidence", file))),
      )
    ).filter((item): item is EvidenceRecord => Boolean(item))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return records
}

export async function writeEvidence(worktree: string, input: EvidenceInput): Promise<EvidenceWriteResult> {
  const now = new Date().toISOString()
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const evidenceID = makeEvidenceID(input)
  const json = path.join(root, "evidence", `${evidenceID}.json`)
  const current = await readJson<EvidenceRecord>(json)
  const rawRelativePath = input.content === undefined ? undefined : path.join("evidence", "raw", `${evidenceID}.txt`)
  const rawPath = rawRelativePath ? path.join(root, rawRelativePath) : undefined
  const record: EvidenceRecord = {
    operationID,
    evidenceID,
    title: input.title,
    kind: input.kind,
    summary: input.summary,
    source: input.source,
    command: input.command,
    path: input.path ?? rawRelativePath,
    time: {
      created: current?.time.created ?? now,
      updated: now,
    },
  }
  if (rawPath) {
    await fs.mkdir(path.dirname(rawPath), { recursive: true })
    await fs.writeFile(rawPath, input.content ?? "")
  }
  await writeJson(json, record)
  await appendJsonl(path.join(root, "evidence.jsonl"), { type: "evidence", ...record })
  await publishOperationUpdated(worktree, { operationID, artifact: "evidence", path: json })
  return { operationID, evidenceID, json, rawPath, record }
}

async function readReportText(root: string) {
  for (const candidate of [
    path.join("reports", "report.md"),
    path.join("reports", "report.html"),
    path.join("deliverables", "final", "report.html"),
  ]) {
    try {
      return await fs.readFile(path.join(root, candidate), "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return undefined
}

async function readAuthoredReport(root: string) {
  for (const candidate of [
    { path: path.join("reports", "report.html"), format: "html" as const },
    { path: path.join("reports", "report.md"), format: "markdown" as const },
  ]) {
    try {
      return {
        format: candidate.format,
        content: await fs.readFile(path.join(root, candidate.path), "utf8"),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return undefined
}

function markdownInline(input: string) {
  return escapeHtml(input)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
}

function markdownReportToHtml(input: string) {
  const blocks: string[] = []
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(`<p>${markdownInline(paragraph.join(" "))}</p>`)
    paragraph = []
  }
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      const level = Math.min(3, heading[1]!.length)
      blocks.push(`<h${level}>${markdownInline(heading[2]!)}</h${level}>`)
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  return blocks.join("\n")
}

function authoredReportBody(input: { format: "html" | "markdown"; content: string }) {
  if (input.format === "markdown") return markdownReportToHtml(input.content)
  return /<body[^>]*>([\s\S]*?)<\/body>/i.exec(input.content)?.[1] ?? input.content
}

function markdownHeadingPattern(value: string) {
  return new RegExp(`^#{1,6}\\s+.*${escapeRegExp(value)}.*$`, "im")
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function plainReportText(report: string) {
  return report
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function reportSectionForFinding(report: string, finding: FindingRecord) {
  const heading =
    markdownHeadingPattern(finding.findingID).exec(report) ?? markdownHeadingPattern(finding.title).exec(report)
  if (heading?.index !== undefined) {
    const bodyStart = heading.index + heading[0].length
    const rest = report.slice(bodyStart)
    const nextHeading = /\n#{1,6}\s+\S/.exec(rest)
    return plainReportText(nextHeading ? rest.slice(0, nextHeading.index) : rest)
  }

  const lower = report.toLowerCase()
  const titleIndex = lower.indexOf(finding.title.toLowerCase())
  const idIndex = lower.indexOf(finding.findingID.toLowerCase())
  const anchors = [titleIndex, idIndex].filter((index) => index >= 0)
  if (!anchors.length) return undefined
  return plainReportText(report.slice(Math.min(...anchors)))
}

function outlineTargetPages(outline: string | undefined) {
  if (!outline) return undefined
  const match = outline.match(/^- target_pages:\s*(\d+)/m)
  if (!match?.[1]) return undefined
  const pages = Number.parseInt(match[1], 10)
  return Number.isFinite(pages) && pages > 0 ? pages : undefined
}

type OutlineSectionBudget = {
  title: string
  pages: number
}

function normalizeSectionTitle(value: string) {
  return plainReportText(value)
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function outlineSectionBudgets(outline: string | undefined): OutlineSectionBudget[] {
  if (!outline) return []
  const pageBudgetHeading = /^##\s+Page Budget\s*$/im.exec(outline)
  if (pageBudgetHeading?.index === undefined) return []
  const pageBudgetStart = pageBudgetHeading.index + pageBudgetHeading[0].length
  const rest = outline.slice(pageBudgetStart)
  const nextHeading = /^##\s+/im.exec(rest)
  const pageBudget = nextHeading ? rest.slice(0, nextHeading.index) : rest
  if (!pageBudget) return []
  const sections: OutlineSectionBudget[] = []
  for (const match of pageBudget.matchAll(/^\s*-\s+(.+):\s*(\d+)\s+pages?\b/gim)) {
    const title = match[1]?.trim()
    const pages = Number.parseInt(match[2] ?? "", 10)
    if (title && Number.isFinite(pages) && pages > 0) sections.push({ title, pages })
  }
  return sections
}

function reportSectionForOutlineTitle(report: string, title: string) {
  const target = normalizeSectionTitle(title)
  if (!target) return undefined
  const headings: Array<{ index: number; end: number; text: string }> = []

  for (const match of report.matchAll(/^#{1,6}\s+(.+)$/gim)) {
    if (match.index === undefined) continue
    headings.push({ index: match.index, end: match.index + match[0].length, text: match[1] ?? "" })
  }
  for (const match of report.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gim)) {
    if (match.index === undefined) continue
    headings.push({ index: match.index, end: match.index + match[0].length, text: match[2] ?? "" })
  }

  headings.sort((left, right) => left.index - right.index)
  const headingIndex = headings.findIndex((heading) => normalizeSectionTitle(heading.text).includes(target))
  if (headingIndex < 0) return undefined
  const heading = headings[headingIndex]!
  const next = headings.find((candidate, index) => index > headingIndex && candidate.index > heading.index)
  return plainReportText(report.slice(heading.end, next?.index ?? report.length))
}

export async function writeReportOutline(worktree: string, input: ReportOutlineInput) {
  const root = operationPath(worktree, input.operationID)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  const findings = await readFindings(root)
  const reportReady = findings.filter((item) => item.state === "report_ready" || item.state === "validated")
  const targetPages = input.targetPages ?? 40
  const audience = input.audience ?? "mixed"
  const appendix = input.includeAppendix ?? true
  const sections: Array<[string, number]> = [
    ["Executive Summary", 3],
    ["Scope, Authorization, and Methodology", 3],
    ["Environment Overview", 4],
    ["Attack Path Narrative", 5],
    ["Findings Detail", Math.max(10, reportReady.length * 3)],
    ["Risk Register and Prioritized Roadmap", 4],
    ["Validation Limits and Known Unknowns", 2],
    ["Evidence Map", 3],
    ...(appendix ? [["Appendix: Raw Evidence Index", 6] as [string, number]] : []),
  ]
  const allocated = sections.reduce((sum, [, pages]) => sum + pages, 0)
  const multiplier = targetPages > allocated ? targetPages / allocated : 1
  const body = [
    `# Report Outline: ${operation?.operationID ?? slug(input.operationID, "operation")}`,
    "",
    `- audience: ${audience}`,
    `- target_pages: ${targetPages}`,
    `- objective: ${operation?.objective ?? "unknown"}`,
    `- reportable_findings: ${reportReady.length}`,
    "",
    "## Page Budget",
    ...sections.map(([title, pages]) => `- ${title}: ${Math.max(1, Math.round(pages * multiplier))} pages`),
    "",
    "## Required Finding Coverage",
    ...(reportReady.length
      ? reportReady.map(
          (finding) =>
            `- ${finding.findingID}: ${finding.title} (${finding.severity}) - evidence: ${finding.evidence
              .map((item) => item.id)
              .join(", ")}`,
        )
      : ["- No validated/report-ready findings yet. Report writer must not invent them."]),
    "",
    "## Report Writer Contract",
    "- Every finding section must include affected assets, evidence, impact, remediation, confidence, and validation limits.",
    "- Every evidence claim must cite a stored evidence id or path.",
    "- Sparse sections should be expanded with methodology, observations, validation detail, and remediation sequencing, not filler.",
    "- Known unknowns and rejected findings belong in the report when they affect decision-making.",
    "",
  ].join("\n")
  const file = path.join(root, "reports", "report-outline.md")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
  await publishOperationUpdated(worktree, { operationID: slug(input.operationID, "operation"), artifact: "report_outline", path: file })
  return { root, file, targetPages, reportReady: reportReady.length }
}

export async function readOperationStatus(
  worktree: string,
  operationID: string,
  options: { eventLimit?: number } = {},
): Promise<OperationStatusSummary> {
  const id = slug(operationID, "operation")
  const root = operationPath(worktree, id)
  const findings = await readFindings(root)
  const evidence = await readEvidenceRecords(root)
  const byState = Object.fromEntries(FINDING_STATES.map((state) => [state, 0])) as Record<FindingState, number>
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>
  const byKind = Object.fromEntries(EVIDENCE_KINDS.map((kind) => [kind, 0])) as Record<EvidenceKind, number>
  const runtime = await readJson<RuntimeSummaryRecord>(path.join(root, "deliverables", "runtime-summary.json"))
  for (const finding of findings) {
    byState[finding.state]++
    bySeverity[finding.severity]++
  }
  for (const item of evidence) byKind[item.kind]++
  return {
    operationID: id,
    root,
    operation: await readJson<OperationRecord>(path.join(root, "operation.json")),
    plans: {
      operation: await exists(path.join(root, "plans", "operation-plan.json")),
    },
    findings: {
      total: findings.length,
      byState,
      bySeverity,
    },
    evidence: {
      total: evidence.length,
      byKind,
    },
    reports: {
      outline: await exists(path.join(root, "reports", "report-outline.md")),
      markdown: await exists(path.join(root, "reports", "report.md")),
      html:
        (await exists(path.join(root, "reports", "report.html"))) ||
        (await exists(path.join(root, "deliverables", "final", "report.html"))),
      pdf: await exists(path.join(root, "deliverables", "final", "report.pdf")),
      readme: await exists(path.join(root, "deliverables", "final", "README.md")),
      manifest: await exists(path.join(root, "deliverables", "final", "manifest.json")),
    },
    runtimeSummary: !!runtime,
    runtime: runtime
      ? {
          generatedAt: runtime.generatedAt,
          modelCalls: runtime.modelCalls,
          usage: runtime.usage,
          compaction: runtime.compaction,
          fetches: runtime.fetches,
          backgroundTasks: runtime.backgroundTasks,
          notes: runtime.notes,
        }
      : undefined,
    lastEvents: await readJsonlTail(path.join(root, "events.jsonl"), options.eventLimit ?? 5),
  }
}

export async function listOperationStatuses(
  worktree: string,
  options: { eventLimit?: number } = {},
): Promise<OperationStatusSummary[]> {
  const root = operationsRoot(worktree)
  if (!(await exists(root))) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const operationIDs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  return Promise.all(operationIDs.map((operationID) => readOperationStatus(worktree, operationID, options)))
}

export async function writeRuntimeSummary(
  worktree: string,
  input: RuntimeSummaryInput,
): Promise<RuntimeSummaryResult> {
  const resolvedInput = mergeRuntimeUsage(input)
  const operationID = slug(resolvedInput.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  const finalDir = path.join(root, "deliverables")
  const record: RuntimeSummaryRecord = {
    ...resolvedInput,
    sessionMessages: undefined,
    operationID,
    generatedAt: new Date().toISOString(),
    operation: operation
      ? {
          stage: operation.stage,
          status: operation.status,
          summary: operation.summary,
          nextActions: operation.nextActions,
          blockers: operation.blockers,
          activeTasks: operation.activeTasks,
        }
      : undefined,
    artifacts: {
      root,
      status: path.join(root, "status.md"),
      events: path.join(root, "events.jsonl"),
      findings: path.join(root, "findings"),
      final: path.join(root, "deliverables", "final"),
    },
  }
  const json = path.join(finalDir, "runtime-summary.json")
  const markdown = path.join(finalDir, "runtime-summary.md")
  await writeJson(json, record)
  await fs.writeFile(markdown, runtimeSummaryMarkdown(record))
  await publishOperationUpdated(worktree, { operationID, artifact: "runtime_summary", path: json })
  return { operationID, json, markdown, finalDir }
}

export async function writeOperationPlan(
  worktree: string,
  input: OperationPlanInput,
): Promise<OperationPlanResult> {
  const gaps = validateOperationPlan(input)
  if (gaps.length) throw new Error(gaps.join("; "))

  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  const record: OperationPlanRecord = {
    ...input,
    operationID,
    writtenAt: new Date().toISOString(),
    objective: operation?.objective,
  }
  const json = path.join(root, "plans", "operation-plan.json")
  const markdown = path.join(root, "plans", "operation-plan.md")
  await writeJson(json, record)
  await fs.writeFile(markdown, operationPlanMarkdown(record))
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "operation_plan",
    operationID,
    phases: record.phases.length,
    writtenAt: record.writtenAt,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "operation_plan", path: json })
  return { operationID, json, markdown, phases: record.phases.length }
}

export async function lintReport(
  worktree: string,
  operationID: string,
  options: ReportLintOptions = {},
): Promise<ReportLintResult> {
  const root = operationPath(worktree, operationID)
  const gaps: string[] = []
  const requireOperationPlan = options.finalHandoff || options.requireOperationPlan
  const requireRenderedDeliverables = options.finalHandoff || options.requireRenderedDeliverables
  const requireRuntimeSummary = options.finalHandoff || options.requireRuntimeSummary
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  if (!operation) gaps.push("operation.json is missing")
  if (operation && operation.status !== "complete" && operation.stage === "handoff") {
    gaps.push("handoff stage must be marked complete before final report handoff")
  }
  if (options.finalHandoff && operation) {
    if (operation.stage !== "handoff") gaps.push("operation stage must be handoff for final handoff")
    if (operation.status !== "complete") gaps.push("operation status must be complete for final handoff")
  }

  const findings = await readFindings(root)
  const evidenceRecords = await readEvidenceRecords(root)
  const evidenceIDs = new Set(evidenceRecords.map((item) => item.evidenceID))
  const evidencePaths = new Set(evidenceRecords.flatMap((item) => (item.path ? [item.path] : [])))

  for (const finding of findings) {
    for (const gap of validateFinding(finding)) gaps.push(`${finding.findingID}: ${gap}`)
    if (finding.state === "candidate") gaps.push(`${finding.findingID}: candidate finding is not reportable`)
    if (finding.state === "needs_validation") gaps.push(`${finding.findingID}: finding still needs validation`)
    if (finding.state === "validated" || finding.state === "report_ready") {
      for (const ref of finding.evidence) {
        if (!evidenceIDs.has(ref.id) && (!ref.path || !evidencePaths.has(ref.path))) {
          gaps.push(`${finding.findingID}: evidence reference ${ref.id} is not recorded`)
        }
      }
    }
  }

  const counts = {
    findings: findings.length,
    reportReady: findings.filter((item) => item.state === "report_ready").length,
    validated: findings.filter((item) => item.state === "validated").length,
    candidates: findings.filter((item) => item.state === "candidate" || item.state === "needs_validation").length,
    rejected: findings.filter((item) => item.state === "rejected").length,
  }
  if (counts.findings === 0) gaps.push("no findings were recorded")
  if (counts.reportReady === 0 && counts.validated === 0) gaps.push("no validated or report-ready findings exist")

  const report = await readReportText(root)
  if (options.requireReport && !report) gaps.push("reports/report.md or reports/report.html is required")
  if (report && options.minWords) {
    const words = wordCount(plainReportText(report))
    if (words < options.minWords) gaps.push(`report is too sparse: ${words} words, expected at least ${options.minWords}`)
  }
  const requireOutlineBudget = options.requireOutlineBudget || options.minOutlineWordsPerPage
  const requireOutlineSections =
    options.requireOutlineSections || options.minOutlineSectionWords || options.minOutlineSectionWordsPerPage
  if (requireOutlineBudget || requireOutlineSections) {
    const outline = await readText(path.join(root, "reports", "report-outline.md"))
    if (requireOutlineBudget) {
      const targetPages = outlineTargetPages(outline)
      if (!targetPages) gaps.push("reports/report-outline.md with target_pages is required for outline budget lint")
      if (!report) gaps.push("report is required for outline budget lint")
      if (report && targetPages) {
        const words = wordCount(plainReportText(report))
        const wordsPerPage = options.minOutlineWordsPerPage ?? 300
        const expected = targetPages * wordsPerPage
        if (words < expected) {
          gaps.push(
            `report misses outline budget: ${words} words, expected at least ${expected} for ${targetPages} target pages`,
          )
        }
      }
    }
    if (requireOutlineSections) {
      const sections = outlineSectionBudgets(outline)
      if (!sections.length) gaps.push("reports/report-outline.md Page Budget sections are required for section lint")
      if (!report) gaps.push("report is required for outline section lint")
      if (report) {
        for (const section of sections) {
          const reportSection = reportSectionForOutlineTitle(report, section.title)
          if (!reportSection) {
            gaps.push(`${section.title}: outline section is missing`)
            continue
          }
          const words = wordCount(reportSection)
          const expected =
            options.minOutlineSectionWords ?? section.pages * (options.minOutlineSectionWordsPerPage ?? 120)
          if (words < expected) {
            gaps.push(`${section.title}: outline section is too sparse: ${words} words, expected at least ${expected}`)
          }
        }
      }
    }
  }
  if (report && (options.requireFindingSections || options.minFindingWords)) {
    for (const finding of findings.filter((item) => item.state === "report_ready" || item.state === "validated")) {
      const section = reportSectionForFinding(report, finding)
      if (!section) {
        gaps.push(`${finding.findingID}: report section is missing`)
        continue
      }
      if (options.minFindingWords) {
        const words = wordCount(section)
        if (words < options.minFindingWords) {
          gaps.push(
            `${finding.findingID}: report section is too sparse: ${words} words, expected at least ${options.minFindingWords}`,
          )
        }
      }
    }
  }
  if (requireOperationPlan && !(await exists(path.join(root, "plans", "operation-plan.json")))) {
    gaps.push("plans/operation-plan.json is required")
  }
  if (requireRenderedDeliverables) {
    if (!(await exists(path.join(root, "deliverables", "final", "report.html")))) {
      gaps.push("deliverables/final/report.html is required")
    }
    if (!(await exists(path.join(root, "deliverables", "final", "report.pdf")))) {
      gaps.push("deliverables/final/report.pdf is required")
    }
    if (!(await exists(path.join(root, "deliverables", "final", "README.md")))) {
      gaps.push("deliverables/final/README.md is required")
    }
    if (!(await exists(path.join(root, "deliverables", "final", "manifest.json")))) {
      gaps.push("deliverables/final/manifest.json is required")
    }
  }
  if (requireRuntimeSummary && !(await exists(path.join(root, "deliverables", "runtime-summary.json")))) {
    gaps.push("deliverables/runtime-summary.json is required")
  }

  return {
    operationID: slug(operationID, "operation"),
    ok: gaps.length === 0,
    checkedAt: new Date().toISOString(),
    gaps,
    counts,
  }
}

function reportOutlineTitles(outline: string | undefined) {
  const titles = outlineSectionBudgets(outline).map((section) => section.title)
  return titles.length
    ? titles
    : [
        "Executive Summary",
        "Scope, Authorization, and Methodology",
        "Findings Detail",
        "Risk Register and Prioritized Roadmap",
        "Validation Limits and Known Unknowns",
        "Evidence Map",
      ]
}

function renderEvidenceRows(evidence: EvidenceRecord[]) {
  return evidence.length
    ? evidence
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.evidenceID)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(
              item.title,
            )}</td><td>${escapeHtml(item.path ?? "")}</td><td>${escapeHtml(item.summary)}</td></tr>`,
        )
        .join("\n")
    : '<tr><td colspan="5">No evidence records were recorded.</td></tr>'
}

function renderFindingRows(reportable: FindingRecord[]) {
  return reportable.length
    ? reportable
        .map(
          (finding) =>
            `<tr><td>${escapeHtml(finding.findingID)}</td><td>${escapeHtml(finding.severity)}</td><td>${escapeHtml(
              finding.title,
            )}</td><td>${escapeHtml(finding.state)}</td><td>${escapeHtml(
              finding.evidence.map((item) => item.path ?? item.id).join(", "),
            )}</td></tr>`,
        )
        .join("\n")
    : '<tr><td colspan="5">No validated or report-ready findings were recorded.</td></tr>'
}

function renderFindingSections(reportable: FindingRecord[]) {
  return reportable.length
    ? reportable
        .map(
          (finding) => `<section class="finding">
    <h3>${escapeHtml(finding.title)}</h3>
    <p><strong>Severity:</strong> ${escapeHtml(finding.severity)} | <strong>Confidence:</strong> ${finding.confidence}</p>
    <p><strong>Affected Assets:</strong> ${escapeHtml(finding.affectedAssets.join(", "))}</p>
    <p><strong>Description:</strong> ${escapeHtml(finding.description)}</p>
    <p><strong>Impact:</strong> ${escapeHtml(finding.impact ?? "Not recorded.")}</p>
    <p><strong>Remediation:</strong> ${escapeHtml(finding.remediation ?? "Not recorded.")}</p>
    <p><strong>Evidence:</strong> ${escapeHtml(finding.evidence.map((item) => item.path ?? item.id).join(", "))}</p>
  </section>`,
        )
        .join("\n")
    : "<p>No validated or report-ready findings were recorded.</p>"
}

function renderReportSections(input: {
  outline: string | undefined
  operation: OperationRecord | undefined
  plan: OperationPlanRecord | undefined
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
  counts: Record<FindingState, number>
}) {
  const assets = [...new Set(input.reportable.flatMap((finding) => finding.affectedAssets))].sort()
  const evidenceKinds = [...new Set(input.evidence.map((item) => item.kind))].sort()
  return reportOutlineTitles(input.outline)
    .map((title) => {
      const normalized = normalizeSectionTitle(title)
      if (normalized.includes("executive summary")) {
        return `<h2>${escapeHtml(title)}</h2>
  <p>${escapeHtml(input.operation?.summary ?? "No operation summary has been recorded.")}</p>
  <p>This handoff contains ${input.reportable.length} report-ready findings, ${input.evidence.length} evidence records, and ${input.nonReportable.length} retained non-reportable findings so reviewers can separate confirmed risk from unresolved or rejected observations.</p>`
      }
      if (normalized.includes("scope") && normalized.includes("methodology")) {
        return `<h2>${escapeHtml(title)}</h2>
  <p>${escapeHtml(input.operation?.objective ?? "No objective has been recorded.")}</p>
  <p>Testing followed the recorded operation plan, preserved raw support through evidence records, promoted only evidence-backed findings, and used stage, lint, render, runtime, and audit gates before handoff.</p>
  <p>Assumptions: ${escapeHtml(input.plan?.assumptions?.join("; ") || "No explicit assumptions were recorded.")}</p>`
      }
      if (normalized.includes("environment overview")) {
        return `<h2>${escapeHtml(title)}</h2>
  <p>Recorded affected assets include ${escapeHtml(assets.join(", ") || "none recorded")}. Evidence kinds represented in the ledger include ${escapeHtml(evidenceKinds.join(", ") || "none recorded")}.</p>
  <p>The environment overview is intentionally limited to operation artifacts and synthetic evidence available at render time, so unverified systems are not invented in the client deliverable.</p>`
      }
      if (normalized.includes("attack path")) {
        return `<h2>${escapeHtml(title)}</h2>
  <p>The confirmed attack narrative is derived from report-ready findings only: ${escapeHtml(
    input.reportable.map((finding) => `${finding.findingID}: ${finding.description}`).join(" ") ||
      "no report-ready attack path was recorded",
  )}</p>
  <p>Rejected and candidate observations are retained separately so the report does not overstate exploitability or imply validation that did not happen.</p>`
      }
      if (normalized.includes("findings detail")) {
        return `<h2>${escapeHtml(title)}</h2>
  <p>Each detailed finding below includes severity, confidence, affected assets, description, impact, remediation, and evidence references from the durable operation ledger.</p>
  ${renderFindingSections(input.reportable)}`
      }
      if (normalized.includes("risk register") || normalized.includes("roadmap")) {
        return `<h2>${escapeHtml(title)}</h2>
  <p>The prioritized remediation roadmap should start with critical and high severity report-ready findings, then address medium and low items based on affected assets, exploitability, and operational owner availability.</p>
  <table>
    <thead><tr><th>ID</th><th>Severity</th><th>Title</th><th>State</th><th>Evidence</th></tr></thead>
    <tbody>${renderFindingRows(input.reportable)}</tbody>
  </table>`
      }
      if (normalized.includes("validation limits") || normalized.includes("known unknowns")) {
        return `<h2>${escapeHtml(title)}</h2>
  <p>Validation limits are represented by unresolved or rejected findings, recorded blockers, and missing evidence. Current blockers: ${escapeHtml(
    input.operation?.blockers?.join("; ") || "No blockers recorded.",
  )}</p>
  <table>
    <thead><tr><th>ID</th><th>State</th><th>Severity</th><th>Title</th><th>Reason Retained</th></tr></thead>
    <tbody>${
      input.nonReportable.length
        ? input.nonReportable
            .map(
              (finding) =>
                `<tr><td>${escapeHtml(finding.findingID)}</td><td>${escapeHtml(finding.state)}</td><td>${escapeHtml(
                  finding.severity,
                )}</td><td>${escapeHtml(
                  finding.title,
                )}</td><td>Not promoted to validated/report-ready state at handoff.</td></tr>`,
            )
            .join("\n")
        : '<tr><td colspan="5">No rejected, candidate, or needs-validation findings were recorded.</td></tr>'
    }</tbody>
  </table>`
      }
      if (normalized.includes("evidence map")) {
        return `<h2>${escapeHtml(title)}</h2>
  <p>The Evidence Index maps report claims back to stored evidence identifiers and paths, keeping the handoff reviewable after context compaction or process restart.</p>
  <table>
    <thead><tr><th>ID</th><th>Kind</th><th>Title</th><th>Path</th><th>Summary</th></tr></thead>
    <tbody>${renderEvidenceRows(input.evidence)}</tbody>
  </table>`
      }
      if (normalized.includes("appendix") || normalized.includes("raw evidence")) {
        return `<h2>${escapeHtml(title)}</h2>
  <p>The raw evidence appendix preserves command outputs, HTTP responses, files, screenshots, notes, and logs that support the report. Reviewers should use these paths to verify each claim before remediation planning.</p>
  <table>
    <thead><tr><th>ID</th><th>Kind</th><th>Title</th><th>Path</th><th>Summary</th></tr></thead>
    <tbody>${renderEvidenceRows(input.evidence)}</tbody>
  </table>`
      }
      return `<h2>${escapeHtml(title)}</h2>
  <p>This section is reserved by the report outline. The current render uses available operation summary, findings, evidence, blockers, and runtime artifacts to avoid inventing details beyond the durable ledger.</p>`
    })
    .join("\n")
}

export async function renderReport(worktree: string, input: ReportRenderInput): Promise<ReportRenderResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  const plan = await readJson<OperationPlanRecord>(path.join(root, "plans", "operation-plan.json"))
  const outline = await readText(path.join(root, "reports", "report-outline.md"))
  const findings = await readFindings(root)
  const evidence = await readEvidenceRecords(root)
  const authoredReport = await readAuthoredReport(root)
  const reportable = findings.filter((finding) => finding.state === "report_ready" || finding.state === "validated")
  const nonReportable = findings.filter((finding) => finding.state !== "report_ready" && finding.state !== "validated")
  const counts = findingCounts(findings)
  const title = input.title ?? operation?.objective ?? `ULMCode Operation ${operationID}`
  const finalDir = path.join(root, "deliverables", "final")
  const reportBody = authoredReport
    ? authoredReportBody(authoredReport)
    : renderReportSections({ outline, operation, plan, reportable, nonReportable, evidence, counts })
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; margin: 48px; line-height: 1.55; }
    h1, h2, h3 { line-height: 1.15; }
    h1 { font-size: 34px; margin-bottom: 8px; }
    h2 { border-top: 1px solid #ccc; padding-top: 24px; margin-top: 32px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f2f2f2; }
    .meta { color: #555; }
    .finding { page-break-inside: avoid; }
    @media print { body { margin: 0.65in; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Operation: ${escapeHtml(operationID)} | Stage: ${escapeHtml(operation?.stage ?? "unknown")} | Status: ${escapeHtml(operation?.status ?? "unknown")}</p>
  <h2>Finding State Counts</h2>
  <table>
    <thead><tr><th>Candidate</th><th>Needs Validation</th><th>Validated</th><th>Report Ready</th><th>Rejected</th></tr></thead>
    <tbody><tr><td>${counts.candidate}</td><td>${counts.needs_validation}</td><td>${counts.validated}</td><td>${counts.report_ready}</td><td>${counts.rejected}</td></tr></tbody>
  </table>
  ${reportBody}
</body>
</html>
`
  await fs.mkdir(finalDir, { recursive: true })
  const htmlPath = path.join(finalDir, "report.html")
  const pdfPath = path.join(finalDir, "report.pdf")
  const readmePath = path.join(finalDir, "README.md")
  const manifestPath = path.join(finalDir, "manifest.json")
  await fs.writeFile(htmlPath, html)
  await fs.writeFile(pdfPath, buildPdf({ title, operationID, operation, reportable, nonReportable, evidence, reportHtml: html }))
  await fs.writeFile(readmePath, finalReadme({ title, operationID, operation, reportable, nonReportable, evidence }))
  await writeJson(manifestPath, {
    operationID,
    title,
    generatedAt: new Date().toISOString(),
    artifacts: {
      status: path.join(root, "status.md"),
      operationPlan: path.join(root, "plans", "operation-plan.json"),
      html: htmlPath,
      pdf: pdfPath,
      readme: readmePath,
      reportOutline: path.join(root, "reports", "report-outline.md"),
      evidence: path.join(root, "evidence"),
      runtimeSummary: path.join(root, "deliverables", "runtime-summary.json"),
    },
    counts: {
      findings: findings.length,
      reportableFindings: reportable.length,
      nonReportableFindings: nonReportable.length,
      byState: counts,
      evidence: evidence.length,
    },
    findings: reportable.map((finding) => finding.findingID),
    nonReportableFindings: nonReportable.map((finding) => finding.findingID),
    evidence: evidence.map((item) => ({
      id: item.evidenceID,
      kind: item.kind,
      title: item.title,
      path: item.path,
    })),
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "report_render", path: manifestPath })
  return {
    operationID,
    html: htmlPath,
    pdf: pdfPath,
    readme: readmePath,
    manifest: manifestPath,
    finalDir,
    findings: reportable.length,
  }
}
