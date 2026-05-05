import fs from "fs/promises"
import path from "path"

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

export type EvidenceRef = {
  id: string
  path?: string
  summary?: string
  command?: string
  createdAt?: string
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
  }>
  notes?: string[]
}

export type RuntimeUsageMessage = {
  role?: string
  agent?: string
  modelID?: string
  providerID?: string
  cost?: number
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
  if (!derived) return input
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
    usage,
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
            `- ${task.id} ${task.status}${task.agent ? ` (${task.agent})` : ""}${task.summary ? ` - ${task.summary}` : ""}`,
        )
      : ["- none recorded"]),
    "",
  ].join("\n")
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
            `- ${task.id}: ${task.status}${task.agent ? ` (${task.agent})` : ""} - ${task.summary ?? ""}`,
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
}) {
  const lines = [
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
  ].flatMap((line) => wrapPdfLine(line))

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
  return { operationID, evidenceID, json, rawPath, record }
}

async function readReportText(root: string) {
  for (const candidate of ["report.md", "report.html"]) {
    try {
      return await fs.readFile(path.join(root, "reports", candidate), "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return undefined
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
    const words = report.trim().split(/\s+/).filter(Boolean).length
    if (words < options.minWords) gaps.push(`report is too sparse: ${words} words, expected at least ${options.minWords}`)
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

export async function renderReport(worktree: string, input: ReportRenderInput): Promise<ReportRenderResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  const findings = await readFindings(root)
  const evidence = await readEvidenceRecords(root)
  const reportable = findings.filter((finding) => finding.state === "report_ready" || finding.state === "validated")
  const nonReportable = findings.filter((finding) => finding.state !== "report_ready" && finding.state !== "validated")
  const counts = findingCounts(findings)
  const title = input.title ?? operation?.objective ?? `ULMCode Operation ${operationID}`
  const finalDir = path.join(root, "deliverables", "final")
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
  <h2>Executive Summary</h2>
  <p>${escapeHtml(operation?.summary ?? "No operation summary has been recorded.")}</p>
  <h2>Scope And Methodology</h2>
  <p>${escapeHtml(operation?.objective ?? "No objective has been recorded.")}</p>
  <h2>Findings Summary</h2>
  <table>
    <thead><tr><th>ID</th><th>Severity</th><th>Title</th><th>State</th><th>Evidence</th></tr></thead>
    <tbody>
      ${
        reportable.length
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
    </tbody>
  </table>
  <h2>Finding State Counts</h2>
  <table>
    <thead><tr><th>Candidate</th><th>Needs Validation</th><th>Validated</th><th>Report Ready</th><th>Rejected</th></tr></thead>
    <tbody><tr><td>${counts.candidate}</td><td>${counts.needs_validation}</td><td>${counts.validated}</td><td>${counts.report_ready}</td><td>${counts.rejected}</td></tr></tbody>
  </table>
  <h2>Detailed Findings</h2>
  ${
    reportable.length
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
  <h2>Evidence Index</h2>
  <table>
    <thead><tr><th>ID</th><th>Kind</th><th>Title</th><th>Path</th><th>Summary</th></tr></thead>
    <tbody>
      ${
        evidence.length
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
    </tbody>
  </table>
  <h2>Non-Reportable Findings</h2>
  <table>
    <thead><tr><th>ID</th><th>State</th><th>Severity</th><th>Title</th><th>Reason Retained</th></tr></thead>
    <tbody>
      ${
        nonReportable.length
          ? nonReportable
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
      }
    </tbody>
  </table>
  <h2>Known Unknowns And Blockers</h2>
  <ul>${(operation?.blockers?.length ? operation.blockers : ["No blockers recorded."])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("")}</ul>
</body>
</html>
`
  await fs.mkdir(finalDir, { recursive: true })
  const htmlPath = path.join(finalDir, "report.html")
  const pdfPath = path.join(finalDir, "report.pdf")
  const readmePath = path.join(finalDir, "README.md")
  const manifestPath = path.join(finalDir, "manifest.json")
  await fs.writeFile(htmlPath, html)
  await fs.writeFile(pdfPath, buildPdf({ title, operationID, operation, reportable, nonReportable, evidence }))
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
