import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"
import { createOperationGoal } from "./operation-goal"
import { writeOperationGraph, type OperationScanProfile, type OperationTrustLevel } from "./operation-graph"
import { writeOperationPlan, writeReportOutline, type Stage } from "./artifact"

export type OperationTemplateID =
  | "single-url-web"
  | "external-k12-district"
  | "authenticated-webapp"
  | "internal-network"
  | "cloud-posture"
  | "code-audit"
  | "report-only"
  | "benchmark-suite"

export type OperationMemoryInput = {
  operationID: string
  action: "read" | "append" | "replace"
  note?: string
  section?: string
}

export type OperationMemoryResult = {
  operationID: string
  file: string
  content: string
  updated: boolean
}

export type AssetGraphInput = {
  operationID: string
  nodes: Array<{
    id: string
    kind: "target" | "host" | "service" | "route" | "api" | "form" | "parameter" | "account" | "role" | "data" | "finding" | "evidence" | "browser_state" | "other"
    label: string
    source?: string
    notes?: string
  }>
  edges?: Array<{ from: string; to: string; relationship: string; evidence?: string[]; confidence?: "low" | "medium" | "high" }>
  notes?: string[]
}

export type AttackChainInput = {
  operationID: string
  chainID?: string
  title: string
  summary: string
  steps: Array<{
    title: string
    findingID?: string
    assetID?: string
    evidence?: string[]
    notes?: string
  }>
  impact?: string
  blockers?: string[]
}

export type BrowserEvidenceInput = {
  operationID: string
  evidenceID?: string
  title: string
  url: string
  authState?: "unknown" | "unauthenticated" | "authenticated" | "privileged" | "student" | "teacher" | "admin"
  screenshotPath?: string
  domSnapshotPath?: string
  tracePath?: string
  requestLogPath?: string
  summary: string
  notes?: string[]
}

export type OperationAlertInput = {
  operationID: string
  alertID?: string
  kind: "validated_high" | "validated_critical" | "daemon_stale" | "budget_exhausted" | "handoff_ready" | "blocked" | "custom"
  severity?: "info" | "warning" | "high" | "critical"
  title: string
  message: string
  sinks?: Array<"webhook" | "discord" | "slack" | "email" | "console">
  nextActions?: string[]
}

export type OutputNormalizeInput = {
  operationID: string
  tool: "nmap" | "nuclei" | "httpx" | "ffuf" | "gobuster" | "nikto" | "sqlmap" | "subfinder" | "generic"
  title?: string
  content: string
  sourcePath?: string
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function readText(file: string) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function mdList(items: string[] | undefined, fallback = "- none recorded") {
  return items?.length ? items.map((item) => `- ${item}`) : [fallback]
}

export async function updateOperationMemory(worktree: string, input: OperationMemoryInput): Promise<OperationMemoryResult> {
  const operationID = slug(input.operationID, "operation")
  const file = path.join(operationPath(worktree, operationID), "memory.md")
  const current = (await readText(file)) ?? `# Operation Memory: ${operationID}

This file is for agents working this operation. Keep it short. Record only details that matter after compaction, resume, or subagent handoff.

`
  if (input.action === "read") return { operationID, file, content: current, updated: false }
  const note = input.note?.trim()
  if (!note) throw new Error("note is required when action is append or replace")
  const now = new Date().toISOString()
  const content =
    input.action === "replace"
      ? `# Operation Memory: ${operationID}\n\n${note}\n`
      : `${current.trimEnd()}\n\n## ${input.section?.trim() || "Note"}\n\n- ${now}: ${note}\n`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
  return { operationID, file, content, updated: true }
}

export async function readOperationMemory(worktree: string, operationID: string, maxChars = 4000) {
  const result = await updateOperationMemory(worktree, { operationID, action: "read" })
  return {
    ...result,
    content: result.content.length > maxChars ? `${result.content.slice(0, maxChars)}\n\n[operation memory truncated]` : result.content,
  }
}

export async function writeAssetGraph(worktree: string, input: AssetGraphInput) {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const record = {
    operationID,
    updatedAt: new Date().toISOString(),
    nodes: input.nodes,
    edges: input.edges ?? [],
    notes: input.notes ?? [],
  }
  const json = path.join(root, "graph", "asset-graph.json")
  const markdown = path.join(root, "graph", "asset-graph.md")
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Asset Graph: ${operationID}`,
      "",
      "## Nodes",
      ...record.nodes.map((node) => `- ${node.id} (${node.kind}): ${node.label}${node.notes ? ` - ${node.notes}` : ""}`),
      "",
      "## Edges",
      ...(record.edges.length
        ? record.edges.map((edge) => `- ${edge.from} -> ${edge.to}: ${edge.relationship}${edge.confidence ? ` (${edge.confidence})` : ""}`)
        : ["- none recorded"]),
      "",
      "## Notes",
      ...mdList(record.notes),
      "",
    ].join("\n"),
  )
  return { operationID, json, markdown, nodes: record.nodes.length, edges: record.edges.length }
}

export async function writeAttackChain(worktree: string, input: AttackChainInput) {
  const operationID = slug(input.operationID, "operation")
  const chainID = slug(input.chainID ?? input.title, "attack-chain")
  const root = operationPath(worktree, operationID)
  const record = {
    ...input,
    operationID,
    chainID,
    updatedAt: new Date().toISOString(),
    blockers: input.blockers ?? [],
  }
  const json = path.join(root, "chains", `${chainID}.json`)
  const markdown = path.join(root, "chains", `${chainID}.md`)
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Attack Chain: ${input.title}`,
      "",
      input.summary,
      "",
      "## Steps",
      ...input.steps.map((step, index) => `${index + 1}. ${step.title}${step.findingID ? ` (finding: ${step.findingID})` : ""}${step.assetID ? ` (asset: ${step.assetID})` : ""}`),
      "",
      "## Impact",
      input.impact ?? "No chain-level impact recorded.",
      "",
      "## Blockers",
      ...mdList(record.blockers),
      "",
    ].join("\n"),
  )
  return { operationID, chainID, json, markdown, steps: input.steps.length }
}

export async function writeBrowserEvidence(worktree: string, input: BrowserEvidenceInput) {
  const operationID = slug(input.operationID, "operation")
  const evidenceID = slug(input.evidenceID ?? input.title, "browser-evidence")
  const root = operationPath(worktree, operationID)
  const record = {
    ...input,
    operationID,
    evidenceID,
    capturedAt: new Date().toISOString(),
    notes: input.notes ?? [],
  }
  const json = path.join(root, "browser", `${evidenceID}.json`)
  const markdown = path.join(root, "browser", `${evidenceID}.md`)
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Browser Evidence: ${input.title}`,
      "",
      `- url: ${input.url}`,
      `- auth_state: ${input.authState ?? "unknown"}`,
      `- screenshot: ${input.screenshotPath ?? "none"}`,
      `- dom_snapshot: ${input.domSnapshotPath ?? "none"}`,
      `- trace: ${input.tracePath ?? "none"}`,
      `- request_log: ${input.requestLogPath ?? "none"}`,
      "",
      "## Summary",
      input.summary,
      "",
      "## Notes",
      ...mdList(record.notes),
      "",
    ].join("\n"),
  )
  return { operationID, evidenceID, json, markdown }
}

export async function writeOperationAlert(worktree: string, input: OperationAlertInput) {
  const operationID = slug(input.operationID, "operation")
  const alertID = slug(input.alertID ?? `${input.kind}-${input.title}`, "alert")
  const root = operationPath(worktree, operationID)
  const record = {
    ...input,
    operationID,
    alertID,
    severity: input.severity ?? (input.kind.includes("critical") ? "critical" : input.kind.includes("high") ? "high" : "warning"),
    sinks: input.sinks ?? ["console"],
    nextActions: input.nextActions ?? [],
    createdAt: new Date().toISOString(),
  }
  const json = path.join(root, "alerts", `${alertID}.json`)
  const markdown = path.join(root, "alerts", `${alertID}.md`)
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Operation Alert: ${input.title}`,
      "",
      `- kind: ${record.kind}`,
      `- severity: ${record.severity}`,
      `- sinks: ${record.sinks.join(", ")}`,
      "",
      input.message,
      "",
      "## Next Actions",
      ...mdList(record.nextActions),
      "",
    ].join("\n"),
  )
  return { operationID, alertID, json, markdown, sinks: record.sinks.length }
}

function normalizeLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function normalizeToolOutput(worktree: string, input: OutputNormalizeInput) {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const lines = normalizeLines(input.content)
  const interesting = lines.filter((line) =>
    /open|http|https|critical|high|medium|low|vulnerable|CVE-|SQL|XSS|redirect|admin|login|forbidden|unauthorized|200|301|302|401|403|500/i.test(line),
  )
  const hosts = [...new Set(lines.flatMap((line) => line.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? []))].sort()
  const urls = [...new Set(lines.flatMap((line) => line.match(/https?:\/\/[^\s"'<>]+/gi) ?? []))].sort()
  const ports = [...new Set(lines.flatMap((line) => line.match(/\b\d{1,5}\/tcp\b/gi) ?? []))].sort()
  const record = {
    operationID,
    tool: input.tool,
    title: input.title ?? `${input.tool} normalized output`,
    sourcePath: input.sourcePath,
    generatedAt: new Date().toISOString(),
    counts: { lines: lines.length, interesting: interesting.length, hosts: hosts.length, urls: urls.length, ports: ports.length },
    hosts,
    urls,
    ports,
    interesting: interesting.slice(0, 200),
  }
  const id = slug(record.title, `${input.tool}-output`)
  const json = path.join(root, "normalized-output", `${id}.json`)
  const markdown = path.join(root, "normalized-output", `${id}.md`)
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Normalized Output: ${record.title}`,
      "",
      `- tool: ${record.tool}`,
      `- source: ${record.sourcePath ?? "inline"}`,
      `- lines: ${record.counts.lines}`,
      `- interesting_lines: ${record.counts.interesting}`,
      `- hosts: ${record.counts.hosts}`,
      `- urls: ${record.counts.urls}`,
      `- ports: ${record.counts.ports}`,
      "",
      "## Hosts",
      ...mdList(hosts),
      "",
      "## URLs",
      ...mdList(urls),
      "",
      "## Ports",
      ...mdList(ports),
      "",
      "## Interesting Lines",
      ...mdList(record.interesting),
      "",
    ].join("\n"),
  )
  return { operationID, json, markdown, counts: record.counts }
}

const templateStages: Record<OperationTemplateID, Stage[]> = {
  "single-url-web": ["intake", "recon", "mapping", "validation", "reporting", "handoff"],
  "external-k12-district": ["intake", "recon", "mapping", "validation", "reporting", "handoff"],
  "authenticated-webapp": ["intake", "mapping", "validation", "reporting", "handoff"],
  "internal-network": ["intake", "recon", "mapping", "validation", "reporting", "handoff"],
  "cloud-posture": ["intake", "recon", "mapping", "validation", "reporting", "handoff"],
  "code-audit": ["intake", "mapping", "validation", "reporting", "handoff"],
  "report-only": ["reporting", "handoff"],
  "benchmark-suite": ["intake", "recon", "validation", "reporting", "handoff"],
}

export async function createOperationFromTemplate(
  worktree: string,
  input: {
    operationID?: string
    template: OperationTemplateID
    objective: string
    targetDurationHours?: number
    trustLevel?: OperationTrustLevel
    scanProfile?: OperationScanProfile
    budgetUSD?: number
  },
) {
  const goal = await createOperationGoal(worktree, {
    operationID: input.operationID,
    objective: input.objective,
    targetDurationHours: input.targetDurationHours,
  })
  const phases = templateStages[input.template].map((stage) => ({
    stage,
    objective: `${input.template} ${stage} phase for ${input.objective}`,
    actions: [
      `Use scan profile ${input.scanProfile ?? "balanced"} and trust level ${input.trustLevel ?? "moderate"}.`,
      "Write durable artifacts before relying on chat context.",
      "Update memory.md with important compaction/resume notes.",
    ],
    successCriteria: [
      "Relevant operation artifacts exist on disk.",
      "Blockers and unknowns are explicit.",
      "Report handoff uses stored evidence and final artifacts.",
    ],
    subagents: stage === "reporting" ? ["report-writer", "report-reviewer"] : stage === "validation" ? ["validator"] : ["recon", "attack-map"],
    noSubagents: ["Do not spawn broad workers without a bounded objective."],
  }))
  const plan = await writeOperationPlan(worktree, {
    operationID: goal.operationID,
    templateName: input.template,
    trustLevel: input.trustLevel,
    scanProfile: input.scanProfile,
    browserEvidence: input.template.includes("web") || input.template === "external-k12-district",
    operationMemory: true,
    phases,
    assumptions: [`Template: ${input.template}`],
    reportingCloseout: [
      "Produce a polished HTML/PDF final report from durable artifacts.",
      "Run report_lint with finalHandoff=true before delivery.",
      "Run report_render to produce the final HTML/PDF package.",
      "Run runtime_summary so the handoff includes cost, model, compaction, task, and artifact accounting.",
      "Include coverage, handoff checklist, executive summary, technical appendix, and runtime summary sections.",
    ],
  })
  const graph = await writeOperationGraph(worktree, {
    operationID: goal.operationID,
    budgetUSD: input.budgetUSD,
    trustLevel: input.trustLevel,
    scanProfile: input.scanProfile,
  })
  const outline = await writeReportOutline(worktree, {
    operationID: goal.operationID,
    targetPages: input.template === "report-only" ? 35 : 50,
    designProfile: "premium",
    includeCoverageSection: true,
    includeHandoffChecklist: true,
  })
  const memory = await updateOperationMemory(worktree, {
    operationID: goal.operationID,
    action: "append",
    section: "Template",
    note: `Started from ${input.template}; trust=${input.trustLevel ?? "moderate"}; scan=${input.scanProfile ?? "balanced"}.`,
  })
  return { operationID: goal.operationID, goal, plan, graph, outline, memory: memory.file }
}
