import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { CyberEnvironment } from "@/session/environment"

export namespace ReportBundle {
  export const Finding = z.object({
    id: z.string(),
    title: z.string(),
    severity: z.enum(["critical", "high", "medium", "low", "info"]),
    confidence: z.number().min(0).max(1),
    asset: z.string(),
    evidence: z.string(),
    impact: z.string(),
    recommendation: z.string(),
    safe_reproduction_steps: z.array(z.string()),
    non_destructive: z.literal(true),
  })
  export type Finding = z.infer<typeof Finding>

  export const SourceRecord = z.object({
    source_id: z.string(),
    type: z.enum(["finding_log", "subagent_results", "handoff", "evidence", "session_message"]),
    agent_label: z.string().nullable(),
    session_id: z.string().nullable(),
    invoked_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    path: z.string().nullable(),
    note: z.string(),
  })
  export type SourceRecord = z.infer<typeof SourceRecord>

  export const TimelineEntry = z.object({
    event_id: z.string(),
    type: z.enum(["session_started", "subtask_started", "subtask_completed", "report_finalized"]),
    timestamp: z.string(),
    agent: z.string().nullable(),
    session_id: z.string().nullable(),
    details: z.string(),
  })
  export type TimelineEntry = z.infer<typeof TimelineEntry>

  export const RunMetadata = z.object({
    session_id: z.string(),
    generated_at: z.string(),
    model: z.object({
      provider_id: z.string().nullable(),
      model_id: z.string().nullable(),
    }),
    overrides_used: z.object({
      sensitive_bash_commands_executed: z.number().int().nonnegative(),
      note: z.string(),
    }),
  })
  export type RunMetadata = z.infer<typeof RunMetadata>

  function parseFindingComments(markdown: string): Finding[] {
    const findings: Finding[] = []
    const regex = /<!--\s*finding_json:(\{.*?\})\s*-->/g
    for (const match of markdown.matchAll(regex)) {
      try {
        const parsed = JSON.parse(match[1]) as Record<string, unknown>
        const normalized = Finding.parse({
          ...parsed,
          safe_reproduction_steps: Array.isArray(parsed.safe_reproduction_steps) ? parsed.safe_reproduction_steps : [],
          non_destructive: true,
        })
        findings.push(normalized)
      } catch {
        // keep parsing other findings even if one malformed block exists
      }
    }
    return findings
  }

  function summarizeBySeverity(findings: Finding[]) {
    return findings.reduce<Record<Finding["severity"], number>>(
      (acc, finding) => {
        acc[finding.severity] += 1
        return acc
      },
      { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    )
  }

  function sortBySeverity(findings: Finding[]) {
    const rank: Record<Finding["severity"], number> = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      info: 1,
    }
    return [...findings].sort((a, b) => {
      if (rank[b.severity] !== rank[a.severity]) return rank[b.severity] - rank[a.severity]
      return b.confidence - a.confidence
    })
  }

  function detectModel(messages: MessageV2.WithParts[]) {
    const lastAssistant = [...messages].reverse().find((msg) => msg.info.role === "assistant")
    if (lastAssistant && lastAssistant.info.role === "assistant") {
      return {
        provider_id: lastAssistant.info.providerID,
        model_id: lastAssistant.info.modelID,
      }
    }
    const lastUser = [...messages].reverse().find((msg) => msg.info.role === "user")
    if (lastUser && lastUser.info.role === "user") {
      return {
        provider_id: lastUser.info.model.providerID,
        model_id: lastUser.info.model.modelID,
      }
    }
    return {
      provider_id: null,
      model_id: null,
    }
  }

  function countSensitiveBashExecutions(messages: MessageV2.WithParts[]) {
    let count = 0
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.tool !== "bash") continue
        if (part.state.status !== "completed") continue
        const risk = part.state.metadata?.bash_risk
        if (risk?.level === "sensitive") count += 1
      }
    }
    return count
  }

  async function latestSessionID() {
    let latest: Session.Info | undefined
    for await (const session of Session.list()) {
      if (session.parentID) continue
      if (!latest || session.time.updated > latest.time.updated) latest = session
    }
    if (!latest) throw new Error("No sessions found")
    return latest.id
  }

  async function readIfExists(file: string) {
    return fs.readFile(file, "utf8").catch(() => "")
  }

  async function listSubagentResults(environmentRoot: string) {
    const agentsDir = path.join(environmentRoot, "agents")
    const entries = await fs.readdir(agentsDir, { withFileTypes: true }).catch(() => [])
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(agentsDir, entry.name, "results.md"))
  }

  function buildSources(input: {
    session: Session.Info
    messages: MessageV2.WithParts[]
    findingPath: string
    handoffPath: string
    resultsPaths: string[]
    evidenceRoot: string
  }) {
    const subagentRuns = new Map<
      string,
      {
        agent: string
        invokedAt: string | null
        completedAt: string | null
      }
    >()
    for (const msg of input.messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool" || part.tool !== "task" || part.state.status !== "completed") continue
        const sessionID = part.state.metadata?.sessionId
        const agent = part.state.input?.subagent_type
        if (typeof sessionID !== "string" || typeof agent !== "string") continue
        subagentRuns.set(sessionID, {
          agent,
          invokedAt: part.state.time?.start ? new Date(part.state.time.start).toISOString() : null,
          completedAt: part.state.time?.end ? new Date(part.state.time.end).toISOString() : null,
        })
      }
    }

    const result: SourceRecord[] = [
      {
        source_id: "SRC-001",
        type: "finding_log",
        agent_label: null,
        session_id: input.session.id,
        invoked_at: new Date(input.session.time.created).toISOString(),
        completed_at: new Date(input.session.time.updated).toISOString(),
        path: input.findingPath,
        note: "Canonical finding log",
      },
      {
        source_id: "SRC-002",
        type: "handoff",
        agent_label: null,
        session_id: input.session.id,
        invoked_at: null,
        completed_at: null,
        path: input.handoffPath,
        note: "Cross-agent coordination notes",
      },
      {
        source_id: "SRC-003",
        type: "evidence",
        agent_label: null,
        session_id: input.session.id,
        invoked_at: null,
        completed_at: null,
        path: input.evidenceRoot,
        note: "Evidence root directory",
      },
    ]

    let idx = 4
    for (const item of input.resultsPaths) {
      const sessionID = path.basename(path.dirname(item))
      const run = subagentRuns.get(sessionID)
      result.push({
        source_id: `SRC-${String(idx).padStart(3, "0")}`,
        type: "subagent_results",
        agent_label: run?.agent ?? "subagent",
        session_id: sessionID,
        invoked_at: run?.invokedAt ?? null,
        completed_at: run?.completedAt ?? null,
        path: item,
        note: run?.agent ? `${run.agent} summarized output` : "Subagent summarized output",
      })
      idx++
    }

    for (const msg of input.messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool" || part.tool !== "task" || part.state.status !== "completed") continue
        const agent = part.state.input?.subagent_type
        if (typeof agent !== "string") continue
        result.push({
          source_id: `SRC-${String(idx).padStart(3, "0")}`,
          type: "session_message",
          agent_label: agent,
          session_id: part.state.metadata?.sessionId ?? null,
          invoked_at: part.state.time?.start ? new Date(part.state.time.start).toISOString() : null,
          completed_at: part.state.time?.end ? new Date(part.state.time.end).toISOString() : null,
          path: null,
          note: `Task invocation for ${agent}`,
        })
        idx++
      }
    }

    return result
  }

  function buildTimeline(input: { session: Session.Info; messages: MessageV2.WithParts[] }) {
    const timeline: TimelineEntry[] = [
      {
        event_id: "EVT-001",
        type: "session_started",
        timestamp: new Date(input.session.time.created).toISOString(),
        agent: "pentest",
        session_id: input.session.id,
        details: "Primary pentest session started",
      },
    ]
    let idx = 2
    for (const msg of input.messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool" || part.tool !== "task") continue
        const agent = part.state.input?.subagent_type
        if (typeof agent !== "string") continue
        if (part.state.time?.start) {
          timeline.push({
            event_id: `EVT-${String(idx).padStart(3, "0")}`,
            type: "subtask_started",
            timestamp: new Date(part.state.time.start).toISOString(),
            agent,
            session_id: part.state.metadata?.sessionId ?? null,
            details: `Subtask started: ${agent}`,
          })
          idx++
        }
        if (part.state.status === "completed" && part.state.time?.end) {
          timeline.push({
            event_id: `EVT-${String(idx).padStart(3, "0")}`,
            type: "subtask_completed",
            timestamp: new Date(part.state.time.end).toISOString(),
            agent,
            session_id: part.state.metadata?.sessionId ?? null,
            details: `Subtask completed: ${agent}`,
          })
          idx++
        }
      }
    }
    timeline.push({
      event_id: `EVT-${String(idx).padStart(3, "0")}`,
      type: "report_finalized",
      timestamp: new Date().toISOString(),
      agent: "report_writer",
      session_id: input.session.id,
      details: "Final report bundle generated",
    })
    return timeline
  }

  function renderResultsMarkdown(input: {
    findings: Finding[]
    sources: SourceRecord[]
    findingLog: string
    subagentResults: Array<{ path: string; content: string }>
  }) {
    const sorted = sortBySeverity(input.findings)
    const counts = summarizeBySeverity(sorted)
    const sourceRef = input.sources.map((x) => `${x.source_id}(${x.type})`).join(", ")
    return [
      "# Engagement Results",
      "",
      "## Executive Summary",
      `- Findings: ${sorted.length}`,
      `- Severity: critical=${counts.critical}, high=${counts.high}, medium=${counts.medium}, low=${counts.low}, info=${counts.info}`,
      `- Sources: ${sourceRef}`,
      "",
      "## Findings Narrative",
      ...sorted.map((finding, idx) =>
        [
          `### ${idx + 1}. ${finding.title}`,
          `- ID: ${finding.id}`,
          `- Severity: ${finding.severity}`,
          `- Confidence: ${finding.confidence}`,
          `- Asset: ${finding.asset}`,
          `- Impact: ${finding.impact}`,
          `- Recommendation: ${finding.recommendation}`,
          "",
        ].join("\n"),
      ),
      "",
      "## Subagent Result Consolidation",
      ...input.subagentResults.map((item) =>
        [
          `### ${item.path}`,
          "```markdown",
          item.content.trim() || "_No content_",
          "```",
          "",
        ].join("\n"),
      ),
      "",
      "## Canonical Finding Log",
      "```markdown",
      input.findingLog.trim(),
      "```",
      "",
    ].join("\n")
  }

  function renderRemediationPlan(input: { findings: Finding[] }) {
    const sorted = sortBySeverity(input.findings)
    const top = sorted[0]
    return [
      "# Remediation Plan",
      "",
      "## Primary Objective",
      top
        ? `Address highest-risk finding first: [${top.id}] ${top.title} (${top.severity}).`
        : "No structured findings were available; validate scope and rerun evidence synthesis.",
      "",
      "## 30/60/90 Plan",
      "### 0-30 Days",
      ...sorted.filter((f) => ["critical", "high"].includes(f.severity)).map((f) => `- ${f.id}: ${f.recommendation}`),
      "### 31-60 Days",
      ...sorted.filter((f) => f.severity === "medium").map((f) => `- ${f.id}: ${f.recommendation}`),
      "### 61-90 Days",
      ...sorted.filter((f) => ["low", "info"].includes(f.severity)).map((f) => `- ${f.id}: ${f.recommendation}`),
      "",
      "## Validation Gates",
      "- Re-test all critical/high findings after remediation implementation.",
      "- Confirm detection coverage and incident response telemetry for exploitation paths.",
      "- Update risk register with accepted residual risk and ownership.",
      "",
    ].join("\n")
  }

  function renderFinalReport(input: {
    session: Session.Info
    findings: Finding[]
    metadata: RunMetadata
    remediationPlan: string
    sources: SourceRecord[]
  }) {
    const sorted = sortBySeverity(input.findings)
    const counts = summarizeBySeverity(sorted)
    const references = input.sources.map((source) => `- ${source.source_id}: ${source.note}`).join("\n")
    return [
      "# Client Pentest Report",
      "",
      "## Executive Summary",
      `- Session: ${input.session.id}`,
      `- Generated: ${input.metadata.generated_at}`,
      `- Total findings: ${sorted.length}`,
      `- Severity mix: critical=${counts.critical}, high=${counts.high}, medium=${counts.medium}, low=${counts.low}, info=${counts.info}`,
      "",
      "## Methodology",
      "- Authorized internal assessment with non-destructive-first posture.",
      "- Evidence-backed validation, source traceability, and controlled execution.",
      "",
      "## Findings",
      ...sorted.map((finding) =>
        [
          `### [${finding.id}] ${finding.title}`,
          `- Severity: ${finding.severity}`,
          `- Confidence: ${finding.confidence}`,
          `- Asset: ${finding.asset}`,
          "- Evidence-backed statement: see source index references.",
          "",
          "#### Impact",
          finding.impact,
          "",
          "#### Recommendation",
          finding.recommendation,
          "",
        ].join("\n"),
      ),
      "",
      "## Detection and Telemetry Notes",
      "- Detection opportunities were mapped from validated exploitation paths and observed control gaps.",
      "- Prioritize alerting and response playbooks for high-impact findings.",
      "",
      "## Remediation Plan",
      input.remediationPlan,
      "",
      "## Provenance Index",
      references || "- No sources collected.",
      "",
    ].join("\n")
  }

  async function generatePdf(input: { markdownPath: string; outputPath: string; allowNoPdf: boolean }) {
    const script = path.join(import.meta.dir, "pdf", "generate_report_pdf.py")
    const proc = Bun.spawn({
      cmd: ["python3", script, input.markdownPath, input.outputPath],
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    if (exitCode !== 0) {
      if (input.allowNoPdf) return { ok: false, message: stderr || "pdf generation failed" }
      throw new Error(`PDF generation failed: ${stderr || "unknown python/reportlab error"}`)
    }
    return { ok: true, message: "" }
  }

  export const generate = async (input: {
    sessionID?: string
    outDir?: string
    allowNoPdf?: boolean
    engagementRootOverride?: string
  }) => {
    const sessionID = input.sessionID ?? (await latestSessionID())
    let session = await Session.get(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)

    if (!session.environment) {
      const parentEnvironment = session.parentID
        ? (await Session.get(session.parentID).catch(() => undefined))?.environment
        : undefined
      const ensured = await CyberEnvironment.ensureSharedEnvironment({
        session,
        agentName: "pentest",
        parentEnvironment,
        force: true,
      })
      if (ensured.environment) {
        session = await Session.update(session.id, (draft) => {
          draft.environment = ensured.environment
        })
      }
    } else {
      const ensured = await CyberEnvironment.ensureSharedEnvironment({
        session,
        force: true,
      })
      if (ensured.environment && ensured.changed) {
        session = await Session.update(session.id, (draft) => {
          draft.environment = ensured.environment
        })
      }
    }

    const findingPath = CyberEnvironment.resolveFindingPath(session)
    const legacyFindingPath = path.join(session.directory, "finding.md")
    const findingLog = await fs.readFile(findingPath, "utf8").catch(async () => {
      if (findingPath === legacyFindingPath) {
        throw new Error(`finding.md not found at ${findingPath}`)
      }
      const legacy = await fs
        .readFile(legacyFindingPath, "utf8")
        .catch(() => Promise.reject(new Error(`finding.md not found at ${findingPath}`)))
      await fs.writeFile(findingPath, legacy, { flag: "wx" }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return
        throw error
      })
      return legacy
    })

    const messages = await Session.messages({ sessionID: session.id })
    const model = detectModel(messages)
    const metadata = RunMetadata.parse({
      session_id: session.id,
      generated_at: new Date().toISOString(),
      model,
      overrides_used: {
        sensitive_bash_commands_executed: countSensitiveBashExecutions(messages),
        note: "Sensitive command execution count inferred from bash tool metadata (interactive approvals are runtime-scoped).",
      },
    })

    const findings = parseFindingComments(findingLog)
    const environmentRoot =
      input.engagementRootOverride ??
      session.environment?.root ??
      path.join(session.directory, "engagements", `session-${session.id}`)
    const resultsPaths = await listSubagentResults(environmentRoot)
    const handoffPath = path.join(environmentRoot, "handoff.md")
    const evidenceRoot = path.join(environmentRoot, "evidence")
    const subagentResults = await Promise.all(
      resultsPaths.map(async (resultPath) => ({
        path: resultPath,
        content: await readIfExists(resultPath),
      })),
    )
    const sources = buildSources({
      session,
      messages,
      findingPath,
      handoffPath,
      resultsPaths,
      evidenceRoot,
    })
    const timeline = buildTimeline({ session, messages })

    const outputDir = input.outDir ?? CyberEnvironment.resolveReportsDir(session) ?? path.join(session.directory, "reports")
    await fs.mkdir(outputDir, { recursive: true })

    const reportPlanPath = path.join(outputDir, "report-plan.md")
    const reportOutlinePath = path.join(outputDir, "report-outline.md")
    const reportDraftPath = path.join(outputDir, "report-draft.md")
    const resultsPath = path.join(outputDir, "results.md")
    const remediationPlanPath = path.join(outputDir, "remediation-plan.md")
    const reportPath = path.join(outputDir, "report.md")
    const findingsPath = path.join(outputDir, "findings.json")
    const metadataPath = path.join(outputDir, "run-metadata.json")
    const sourcesPath = path.join(outputDir, "sources.json")
    const timelinePath = path.join(outputDir, "timeline.json")
    const pdfPath = path.join(outputDir, "report.pdf")

    const resultsMarkdown = renderResultsMarkdown({
      findings,
      sources,
      findingLog,
      subagentResults,
    })
    const remediationPlan = renderRemediationPlan({ findings })
    const reportMarkdown = renderFinalReport({
      session,
      findings,
      metadata,
      remediationPlan,
      sources,
    })

    await Promise.all([
      fs.writeFile(
        reportPlanPath,
        [
          "# Report Plan",
          "",
          "- Collect and validate all engagement artifacts.",
          "- Build executive and technical narratives with source traceability.",
          "- Produce remediation and detection guidance.",
          "- Finalize complete markdown + PDF package.",
          "",
        ].join("\n"),
      ),
      fs.writeFile(
        reportOutlinePath,
        [
          "# Report Outline",
          "",
          "1. Executive Summary",
          "2. Methodology and Scope",
          "3. Findings by Severity",
          "4. Detection and Telemetry Notes",
          "5. Remediation Plan",
          "6. Appendix and Provenance",
          "",
        ].join("\n"),
      ),
      fs.writeFile(reportDraftPath, reportMarkdown),
      fs.writeFile(resultsPath, resultsMarkdown),
      fs.writeFile(remediationPlanPath, remediationPlan),
      fs.writeFile(reportPath, reportMarkdown),
      fs.writeFile(findingsPath, JSON.stringify(findings, null, 2) + "\n"),
      fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n"),
      fs.writeFile(sourcesPath, JSON.stringify(sources, null, 2) + "\n"),
      fs.writeFile(timelinePath, JSON.stringify(timeline, null, 2) + "\n"),
    ])

    const pdf = await generatePdf({
      markdownPath: reportPath,
      outputPath: pdfPath,
      allowNoPdf: input.allowNoPdf ?? false,
    })

    return {
      sessionID: session.id,
      outDir: outputDir,
      reportPath,
      reportPdfPath: pdfPath,
      reportPlanPath,
      reportOutlinePath,
      reportDraftPath,
      resultsPath,
      remediationPlanPath,
      findingsPath,
      sourcesPath,
      timelinePath,
      metadataPath,
      findingCount: findings.length,
      sourceCount: sources.length,
      subagentCount: subagentResults.length,
      pdfGenerated: pdf.ok,
      pdfMessage: pdf.message,
    }
  }
}
