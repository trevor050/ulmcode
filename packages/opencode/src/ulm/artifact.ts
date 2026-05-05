import fs from "fs/promises"
import path from "path"

export const STAGES = ["intake", "recon", "mapping", "validation", "reporting", "handoff"] as const
export const OPERATION_STATUSES = ["planned", "running", "blocked", "paused", "complete"] as const
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const
export const FINDING_STATES = ["candidate", "needs_validation", "validated", "report_ready", "rejected"] as const
export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const

export type Stage = (typeof STAGES)[number]
export type OperationStatus = (typeof OPERATION_STATUSES)[number]
export type RiskLevel = (typeof RISK_LEVELS)[number]
export type FindingState = (typeof FINDING_STATES)[number]
export type Severity = (typeof SEVERITIES)[number]

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

export async function lintReport(worktree: string, operationID: string): Promise<ReportLintResult> {
  const root = operationPath(worktree, operationID)
  const gaps: string[] = []
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  if (!operation) gaps.push("operation.json is missing")
  if (operation && operation.status !== "complete" && operation.stage === "handoff") {
    gaps.push("handoff stage must be marked complete before final report handoff")
  }

  let findings: FindingRecord[] = []
  try {
    const files = await fs.readdir(path.join(root, "findings"))
    findings = (
      await Promise.all(
        files.filter((file) => file.endsWith(".json")).map((file) => readJson<FindingRecord>(path.join(root, "findings", file))),
      )
    ).filter((item): item is FindingRecord => Boolean(item))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  for (const finding of findings) {
    for (const gap of validateFinding(finding)) gaps.push(`${finding.findingID}: ${gap}`)
    if (finding.state === "candidate") gaps.push(`${finding.findingID}: candidate finding is not reportable`)
    if (finding.state === "needs_validation") gaps.push(`${finding.findingID}: finding still needs validation`)
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

  return {
    operationID: slug(operationID, "operation"),
    ok: gaps.length === 0,
    checkedAt: new Date().toISOString(),
    gaps,
    counts,
  }
}
