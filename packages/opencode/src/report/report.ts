import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { CyberEnvironment } from "@/session/environment"
import { Config } from "@/config/config"

export namespace ReportBundle {
  const FindingType = z.enum([
    "vulnerability",
    "misconfiguration",
    "compliance_gap",
    "hardening_recommendation",
    "positive_control",
    "detection_gap",
    "policy_violation",
  ])

  export const Finding = z.object({
    id: z.string(),
    title: z.string(),
    severity: z.enum(["critical", "high", "medium", "low", "info"]),
    confidence: z.number().min(0).max(1),
    asset: z.string(),
    evidence: z.string(),
    impact: z.string(),
    recommendation: z.string(),
    finding_type: FindingType.default("vulnerability"),
    control_refs: z
      .array(
        z.object({
          framework: z.string(),
          control_id: z.string(),
          description: z.string().optional(),
        }),
      )
      .default([]),
    baseline_state: z.string().optional(),
    expected_state: z.string().optional(),
    positive_finding: z.boolean().default(false),
    evidence_refs: z
      .array(
        z.object({
          path: z.string(),
          line_hint: z.string().optional(),
        }),
      )
      .default([]),
    safe_reproduction_steps: z.array(z.string()),
    non_destructive: z.boolean().default(true),
  })
  export type Finding = z.infer<typeof Finding>

  export const QualityWarning = z.object({
    code: z.string(),
    level: z.enum(["warning", "error"]),
    message: z.string(),
    finding_id: z.string().optional(),
  })
  export type QualityWarning = z.infer<typeof QualityWarning>

  export const QualitySummary = z.object({
    evidence_link_score: z.number().min(0).max(1),
    claim_validation_score: z.number().min(0).max(1),
    empty_artifact_count: z.number().int().nonnegative(),
    warning_count: z.number().int().nonnegative(),
    quality_status: z.enum(["pass", "warn", "fail"]),
    quality_warnings: z.array(QualityWarning),
  })
  export type QualitySummary = z.infer<typeof QualitySummary>

  export const FindingQuality = z.object({
    finding_id: z.string(),
    adjusted_confidence: z.number().min(0).max(1),
    validation_status: z.enum(["validated", "weak_evidence", "unverified_claims"]),
    evidence_files: z.array(z.string()),
    warning_messages: z.array(z.string()),
    unverified_claims: z.array(z.string()),
  })
  export type FindingQuality = z.infer<typeof FindingQuality>

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
          non_destructive: typeof parsed.non_destructive === "boolean" ? parsed.non_destructive : true,
          finding_type: typeof parsed.finding_type === "string" ? parsed.finding_type : "vulnerability",
          control_refs: Array.isArray(parsed.control_refs) ? parsed.control_refs : [],
          positive_finding: typeof parsed.positive_finding === "boolean" ? parsed.positive_finding : false,
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

  function roundMetric(input: number) {
    return Math.round(input * 1000) / 1000
  }

  function parseEvidencePaths(text: string) {
    const matches = text.match(/(?:^|\s)(\/[^\s`]+|(?:^|[A-Za-z0-9._-]+\/)[^\s`]+(?:\.(?:txt|md|json|log|html)))/g) ?? []
    return matches.map((item) => item.trim().replace(/^[-*]\s*/, ""))
  }

  function extractClaimTokens(finding: Finding) {
    const combined = `${finding.title}\n${finding.evidence}`
    const portClaims = Array.from(combined.matchAll(/\bport(?:s)?\s+(\d{1,5})\b/gi)).map((m) => m[1])
    const versionClaims = [
      ...Array.from(combined.matchAll(/\bversion\s+([0-9]+(?:\.[0-9A-Za-z-]+){1,4})\b/gi)).map((m) => m[1]),
      ...Array.from(combined.matchAll(/\b([A-Za-z][A-Za-z0-9_-]*\/[0-9]+(?:\.[0-9A-Za-z-]+){1,4})\b/g)).map((m) => m[1]),
    ]
    return {
      ports: Array.from(new Set(portClaims)),
      versions: Array.from(new Set(versionClaims)),
    }
  }

  async function readEvidenceFiles(input: {
    finding: Finding
    environmentRoot: string
  }) {
    const rawRefs = [
      ...input.finding.evidence_refs.map((ref) => ref.path),
      ...parseEvidencePaths(input.finding.evidence),
    ]
    const uniqueRefs = Array.from(new Set(rawRefs.filter(Boolean)))
    const resolved = uniqueRefs.map((ref) => {
      if (path.isAbsolute(ref)) return ref
      return path.join(input.environmentRoot, ref)
    })

    const files = await Promise.all(
      resolved.map(async (filePath) => {
        const content = await fs.readFile(filePath, "utf8").catch(() => "")
        const exists = content.length > 0 || (await fs.stat(filePath).then(() => true).catch(() => false))
        return {
          requested: filePath,
          exists,
          content,
        }
      }),
    )

    return {
      files,
      totalRefs: resolved.length,
      nonEmptyCount: files.filter((x) => x.exists && x.content.trim().length > 0).length,
      missingRefs: files.filter((x) => !x.exists).map((x) => x.requested),
      emptyRefs: files.filter((x) => x.exists && x.content.trim().length === 0).map((x) => x.requested),
    }
  }

  async function evaluateQuality(input: {
    findings: Finding[]
    environmentRoot: string
    reportMarkdown: string
    mode: "warn" | "strict"
  }) {
    const warnings: QualityWarning[] = []
    const perFinding: FindingQuality[] = []
    let totalRefs = 0
    let validRefs = 0
    let totalClaims = 0
    let validatedClaims = 0
    let emptyArtifactCount = 0

    for (const finding of input.findings) {
      const evidence = await readEvidenceFiles({
        finding,
        environmentRoot: input.environmentRoot,
      })
      totalRefs += evidence.totalRefs
      validRefs += evidence.nonEmptyCount
      emptyArtifactCount += evidence.emptyRefs.length
      const localWarnings: string[] = []
      const unverifiedClaims: string[] = []

      if (evidence.totalRefs === 0) {
        warnings.push({
          code: "missing_evidence_refs",
          level: "warning",
          message: `${finding.id} has no structured evidence references.`,
          finding_id: finding.id,
        })
        localWarnings.push("No structured evidence references")
      }

      if (
        (finding.finding_type === "compliance_gap" || finding.finding_type === "policy_violation") &&
        finding.control_refs.length === 0
      ) {
        warnings.push({
          code: "missing_control_refs",
          level: "warning",
          message: `${finding.id} is ${finding.finding_type} but has no control_refs mappings.`,
          finding_id: finding.id,
        })
        localWarnings.push("No control mappings for compliance/policy finding")
      }

      if (
        finding.finding_type === "hardening_recommendation" &&
        (!finding.baseline_state || !finding.expected_state)
      ) {
        warnings.push({
          code: "missing_baseline_delta",
          level: "warning",
          message: `${finding.id} is hardening_recommendation but baseline_state/expected_state is incomplete.`,
          finding_id: finding.id,
        })
        localWarnings.push("Incomplete baseline delta metadata")
      }

      for (const missing of evidence.missingRefs) {
        warnings.push({
          code: "missing_evidence_file",
          level: "error",
          message: `${finding.id} references missing evidence file: ${missing}`,
          finding_id: finding.id,
        })
        localWarnings.push(`Missing evidence file: ${missing}`)
      }

      for (const empty of evidence.emptyRefs) {
        warnings.push({
          code: "empty_evidence_file",
          level: "warning",
          message: `${finding.id} references empty evidence file: ${empty}`,
          finding_id: finding.id,
        })
        localWarnings.push(`Empty evidence file: ${empty}`)
      }

      const claims = extractClaimTokens(finding)
      const claimPool = evidence.files.map((x) => x.content.toLowerCase()).join("\n")
      for (const port of claims.ports) {
        totalClaims += 1
        const ok = claimPool.includes(`:${port}`) || claimPool.includes(`port ${port}`) || claimPool.includes(`${port}/tcp`)
        if (ok) validatedClaims += 1
        else {
          unverifiedClaims.push(`port ${port} claim not found in referenced evidence`)
          warnings.push({
            code: "unverified_port_claim",
            level: "warning",
            message: `${finding.id} includes an unverified port claim (${port}).`,
            finding_id: finding.id,
          })
        }
      }
      for (const version of claims.versions) {
        totalClaims += 1
        const ok = claimPool.includes(version.toLowerCase())
        if (ok) validatedClaims += 1
        else {
          unverifiedClaims.push(`version ${version} claim not found in referenced evidence`)
          warnings.push({
            code: "unverified_version_claim",
            level: "warning",
            message: `${finding.id} includes an unverified version claim (${version}).`,
            finding_id: finding.id,
          })
        }
      }

      const evidenceRatio = evidence.totalRefs === 0 ? 0 : evidence.nonEmptyCount / evidence.totalRefs
      const localClaimTotal = claims.ports.length + claims.versions.length
      const localClaimValidated = localClaimTotal - unverifiedClaims.length
      const claimRatio = localClaimTotal === 0 ? 1 : localClaimValidated / localClaimTotal
      const penalty = 1 - Math.min(0.4, (1 - evidenceRatio) * 0.25 + (1 - claimRatio) * 0.15)
      const adjustedConfidence = Math.max(0, Math.min(1, finding.confidence * penalty))

      const status: FindingQuality["validation_status"] =
        unverifiedClaims.length > 0
          ? "unverified_claims"
          : localWarnings.length > 0
            ? "weak_evidence"
            : "validated"

      perFinding.push({
        finding_id: finding.id,
        adjusted_confidence: roundMetric(adjustedConfidence),
        validation_status: status,
        evidence_files: evidence.files.map((x) => x.requested),
        warning_messages: localWarnings,
        unverified_claims: unverifiedClaims,
      })
    }

    if (
      /no remaining next steps|complete and closed|nothing to do/i.test(input.reportMarkdown) &&
      input.findings.some((f) => f.severity !== "info")
    ) {
      warnings.push({
        code: "contradiction_next_steps",
        level: "warning",
        message: "Report text claims no remaining next steps while actionable non-informational findings exist.",
      })
    }

    const evidenceLinkScore = totalRefs === 0 ? 0 : validRefs / totalRefs
    const claimValidationScore = totalClaims === 0 ? 1 : validatedClaims / totalClaims
    const baseStatus: QualitySummary["quality_status"] = warnings.length === 0 ? "pass" : "warn"
    const strictFail =
      input.mode === "strict" &&
      (evidenceLinkScore < 0.85 ||
        claimValidationScore < 0.8 ||
        warnings.some((w) => w.level === "error"))

    const summary: QualitySummary = {
      evidence_link_score: roundMetric(evidenceLinkScore),
      claim_validation_score: roundMetric(claimValidationScore),
      empty_artifact_count: emptyArtifactCount,
      warning_count: warnings.length,
      quality_status: strictFail ? "fail" : baseStatus,
      quality_warnings: warnings,
    }

    return {
      summary,
      perFinding,
    }
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

  async function resolveRootSession(session: Session.Info) {
    let cursor = session
    const visited = new Set<string>()
    while (cursor.parentID && !visited.has(cursor.id)) {
      visited.add(cursor.id)
      const parent = await Session.get(cursor.parentID).catch(() => undefined)
      if (!parent) break
      cursor = parent
    }
    return cursor
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
        if (!("time" in part.state) || !("metadata" in part.state)) continue
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
        if (!("time" in part.state) || !("metadata" in part.state)) continue
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
        if (!("time" in part.state) || !("metadata" in part.state)) continue
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
    quality: QualitySummary
    perFindingQuality: FindingQuality[]
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
      `- Quality status: ${input.quality.quality_status}`,
      `- Evidence link score: ${input.quality.evidence_link_score}`,
      `- Claim validation score: ${input.quality.claim_validation_score}`,
      `- Quality warnings: ${input.quality.warning_count}`,
      "",
      "## Quality Warnings",
      ...(input.quality.quality_warnings.length > 0
        ? input.quality.quality_warnings.map((w) => {
            const prefix = w.level === "error" ? "[error]" : "[warning]"
            return `- ${prefix} ${w.finding_id ? `${w.finding_id}: ` : ""}${w.message}`
          })
        : ["- None"]),
      "",
      "## Findings Narrative",
      ...sorted.map((finding, idx) =>
        [
          `### ${idx + 1}. ${finding.title}`,
          `- ID: ${finding.id}`,
          `- Severity: ${finding.severity}`,
          `- Type: ${finding.finding_type}`,
          `- Positive control: ${finding.positive_finding ? "yes" : "no"}`,
          `- Confidence: ${finding.confidence}`,
          `- Asset: ${finding.asset}`,
          `- Adjusted confidence: ${
            input.perFindingQuality.find((entry) => entry.finding_id === finding.id)?.adjusted_confidence ?? finding.confidence
          }`,
          ...(finding.control_refs.length > 0
            ? [`- Control refs: ${finding.control_refs.map((ref) => `${ref.framework}:${ref.control_id}`).join(", ")}`]
            : []),
          ...(finding.baseline_state || finding.expected_state
            ? [`- Baseline delta: current="${finding.baseline_state ?? "N/A"}", expected="${finding.expected_state ?? "N/A"}"`]
            : []),
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
    const positiveControls = sorted.filter((f) => f.positive_finding)
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
      "## Controls To Preserve",
      ...(positiveControls.length > 0
        ? positiveControls.map((f) => `- ${f.id}: Maintain validated control "${f.title}".`)
        : ["- No explicit positive controls were logged in this engagement."]),
      "",
      "## Validation Gates",
      "- Re-test all critical/high findings after remediation implementation.",
      "- Confirm detection coverage and incident response telemetry for exploitation paths.",
      "- Update risk register with accepted residual risk and ownership.",
      "",
    ].join("\n")
  }

  function stripHeading(markdown: string, heading: string) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return markdown.replace(new RegExp(`^#\\s+${escaped}\\s*\\n+`, "i"), "").trim()
  }

  function renderQualityBanner(quality: QualitySummary) {
    return [
      "## Quality Warnings",
      `- Quality status: ${quality.quality_status}`,
      `- Evidence link score: ${quality.evidence_link_score}`,
      `- Claim validation score: ${quality.claim_validation_score}`,
      `- Empty artifact count: ${quality.empty_artifact_count}`,
      `- Warning count: ${quality.warning_count}`,
      ...(quality.quality_warnings.length > 0
        ? quality.quality_warnings.map((warning) => {
            const level = warning.level === "error" ? "ERROR" : "WARNING"
            return `- [${level}] ${warning.finding_id ? `${warning.finding_id}: ` : ""}${warning.message}`
          })
        : ["- None"]),
      "",
    ].join("\n")
  }

  function renderFinalReport(input: {
    session: Session.Info
    findings: Finding[]
    metadata: RunMetadata
    remediationPlan: string
    sources: SourceRecord[]
    quality: QualitySummary
    perFindingQuality: FindingQuality[]
  }) {
    const sorted = sortBySeverity(input.findings)
    const counts = summarizeBySeverity(sorted)
    const references = input.sources.map((source) => `- ${source.source_id}: ${source.note}`).join("\n")
    const remediationBody = stripHeading(input.remediationPlan, "Remediation Plan")
    const harnessBlockers = sorted.filter((f) =>
      /permission policy blocks editing engagement artifacts/i.test(`${f.title} ${f.evidence}`),
    )
    return [
      "# Client Pentest Report",
      "",
      "## Executive Summary",
      `- Session: ${input.session.id}`,
      `- Generated: ${input.metadata.generated_at}`,
      `- Total findings: ${sorted.length}`,
      `- Severity mix: critical=${counts.critical}, high=${counts.high}, medium=${counts.medium}, low=${counts.low}, info=${counts.info}`,
      `- Quality status: ${input.quality.quality_status}`,
      `- Evidence link score: ${input.quality.evidence_link_score}`,
      `- Claim validation score: ${input.quality.claim_validation_score}`,
      "",
      ...(input.quality.quality_warnings.length > 0 ? [renderQualityBanner(input.quality)] : []),
      "## Methodology",
      "- Authorized internal assessment with non-destructive-first posture.",
      "- Evidence-backed validation, source traceability, and controlled execution.",
      "",
      "## What Worked / What Didn't",
      "### Worked",
      "- Engagement scaffolding, finding lifecycle logging, and report bundling pipeline executed end-to-end.",
      "- Findings were captured with structured evidence and reproducible non-destructive steps.",
      "### Didn’t",
      ...(harnessBlockers.length
        ? harnessBlockers.map(
            (blocker) =>
              `- ${blocker.id}: ${blocker.title} (severity: ${blocker.severity}) blocked expected subagent artifact updates.`,
          )
        : ["- No harness-level workflow blockers were validated in this run."]),
      "",
      "## Findings",
      ...sorted.map((finding) =>
        [
          `### [${finding.id}] ${finding.title}`,
          `- Severity: ${finding.severity}`,
          `- Type: ${finding.finding_type}`,
          `- Positive control: ${finding.positive_finding ? "yes" : "no"}`,
          `- Confidence: ${finding.confidence}`,
          `- Adjusted confidence: ${
            input.perFindingQuality.find((entry) => entry.finding_id === finding.id)?.adjusted_confidence ?? finding.confidence
          }`,
          `- Asset: ${finding.asset}`,
          ...(finding.control_refs.length > 0
            ? [`- Control refs: ${finding.control_refs.map((ref) => `${ref.framework}:${ref.control_id}`).join(", ")}`]
            : []),
          ...(finding.baseline_state || finding.expected_state
            ? [`- Baseline delta: current="${finding.baseline_state ?? "N/A"}", expected="${finding.expected_state ?? "N/A"}"`]
            : []),
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
      "## Known Unknowns",
      ...input.perFindingQuality
        .filter((entry) => entry.validation_status !== "validated")
        .map((entry) => `- ${entry.finding_id}: ${entry.warning_messages.join("; ") || "Weak evidence linkage"}`),
      ...(input.perFindingQuality.some((entry) => entry.validation_status !== "validated")
        ? []
        : ["- None identified."]),
      "",
      "## Unverified Claims",
      ...input.perFindingQuality
        .flatMap((entry) => entry.unverified_claims.map((claim) => `- ${entry.finding_id}: ${claim}`)),
      ...(input.perFindingQuality.some((entry) => entry.unverified_claims.length > 0)
        ? []
        : ["- None identified."]),
      "",
      "## Detection and Telemetry Notes",
      "- Detection opportunities were mapped from validated exploitation paths and observed control gaps.",
      "- Prioritize alerting and response playbooks for high-impact findings.",
      "",
      "## Source Traceability",
      "| Finding ID | Evidence Files | Validation Status | Warnings |",
      "| --- | --- | --- | --- |",
      ...input.perFindingQuality.map((entry) => {
        const files = entry.evidence_files.length > 0 ? entry.evidence_files.join(", ") : "none"
        const warnings = entry.warning_messages.length > 0 ? entry.warning_messages.join("; ") : "none"
        return `| ${entry.finding_id} | ${files} | ${entry.validation_status} | ${warnings} |`
      }),
      "",
      "## Remediation Plan",
      remediationBody || "_No remediation plan provided._",
      "",
      "## Provenance Index",
      references || "- No sources collected.",
      "",
    ].join("\n")
  }

  export const generate = async (input: {
    sessionID?: string
    outDir?: string
    allowNoPdf?: boolean
    engagementRootOverride?: string
    requireAuthoredArtifacts?: boolean
  }) => {
    const config = await Config.get()
    const qualityMode = config.cyber?.report_quality_mode ?? "warn"
    const requestedSessionID = input.sessionID ?? (await latestSessionID())
    let requestedSession = await Session.get(requestedSessionID)
    if (!requestedSession) throw new Error(`Session not found: ${requestedSessionID}`)

    if (!requestedSession.environment) {
      const parentEnvironment = requestedSession.parentID
        ? (await Session.get(requestedSession.parentID).catch(() => undefined))?.environment
        : undefined
      const ensured = await CyberEnvironment.ensureSharedEnvironment({
        session: requestedSession,
        agentName: "pentest",
        parentEnvironment,
        force: true,
      })
      if (ensured.environment) {
        requestedSession = await Session.update(requestedSession.id, (draft) => {
          draft.environment = ensured.environment
        })
      }
    } else {
      const ensured = await CyberEnvironment.ensureSharedEnvironment({
        session: requestedSession,
        force: true,
      })
      if (ensured.environment && ensured.changed) {
        requestedSession = await Session.update(requestedSession.id, (draft) => {
          draft.environment = ensured.environment
        })
      }
    }

    const session = await resolveRootSession(requestedSession)
    const findingPath = CyberEnvironment.resolveFindingPath(session)
    const legacyFindingPath = path.join(requestedSession.directory, "finding.md")
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
      requestedSession.environment?.root ??
      path.join(requestedSession.directory, "engagements", `session-${session.id}`)
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

    const outputDir =
      input.outDir ??
      CyberEnvironment.resolveReportsDir(session) ??
      CyberEnvironment.resolveReportsDir(requestedSession) ??
      path.join(requestedSession.directory, "reports")
    await fs.mkdir(outputDir, { recursive: true })

    const reportPlanPath = path.join(outputDir, "report-plan.md")
    const reportOutlinePath = path.join(outputDir, "report-outline.md")
    const reportDraftPath = path.join(outputDir, "report-draft.md")
    const reportRenderPlanPath = path.join(outputDir, "report-render-plan.md")
    const reportHtmlPath = path.join(outputDir, "report.html")
    const resultsPath = path.join(outputDir, "results.md")
    const remediationPlanPath = path.join(outputDir, "remediation-plan.md")
    const reportPath = path.join(outputDir, "report.md")
    const findingsPath = path.join(outputDir, "findings.json")
    const metadataPath = path.join(outputDir, "run-metadata.json")
    const sourcesPath = path.join(outputDir, "sources.json")
    const timelinePath = path.join(outputDir, "timeline.json")
    const qualityChecksPath = path.join(outputDir, "quality-checks.json")
    const pdfPath = path.join(outputDir, "report.pdf")

    const requireAuthoredArtifacts = input.requireAuthoredArtifacts ?? false
    const [
      existingReportPlan,
      existingReportOutline,
      existingReportDraft,
      existingReportRenderPlan,
      existingReportHtml,
      existingResults,
      existingRemediation,
      existingReport,
    ] =
      await Promise.all([
        readIfExists(reportPlanPath),
        readIfExists(reportOutlinePath),
        readIfExists(reportDraftPath),
        readIfExists(reportRenderPlanPath),
        readIfExists(reportHtmlPath),
        readIfExists(resultsPath),
        readIfExists(remediationPlanPath),
        readIfExists(reportPath),
      ])

    const remediationPlan = existingRemediation.trim() || renderRemediationPlan({ findings })
    const generatedReportMarkdown = renderFinalReport({
      session,
      findings,
      metadata,
      remediationPlan,
      sources,
      quality: {
        evidence_link_score: 1,
        claim_validation_score: 1,
        empty_artifact_count: 0,
        warning_count: 0,
        quality_status: "pass",
        quality_warnings: [],
      },
      perFindingQuality: [],
    })
    const reportDraft = existingReportDraft.trim() || generatedReportMarkdown
    const reportMarkdown = existingReport.trim() || reportDraft
    const reportPlan =
      existingReportPlan.trim() ||
      [
        "# Report Plan",
        "",
        "- Collect and validate all engagement artifacts.",
        "- Build executive and technical narratives with source traceability.",
        "- Produce remediation and detection guidance.",
        "- Finalize complete markdown + PDF package.",
        "",
      ].join("\n")
    const reportOutline =
      existingReportOutline.trim() ||
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
      ].join("\n")
    const qualityEvaluation = await evaluateQuality({
      findings,
      environmentRoot,
      reportMarkdown,
      mode: qualityMode,
    })
    const generatedResultsMarkdown = renderResultsMarkdown({
      findings,
      sources,
      findingLog,
      subagentResults,
      quality: qualityEvaluation.summary,
      perFindingQuality: qualityEvaluation.perFinding,
    })
    const resultsMarkdown = existingResults.trim()
      ? existingResults.includes("## Quality Warnings")
        ? existingResults
        : [renderQualityBanner(qualityEvaluation.summary), existingResults.trim()].join("\n")
      : generatedResultsMarkdown
    const finalReportMarkdown = existingReport.trim()
      ? existingReport.includes("## Quality Warnings")
        ? existingReport
        : [renderQualityBanner(qualityEvaluation.summary), existingReport.trim()].join("\n")
      : renderFinalReport({
          session,
          findings,
          metadata,
          remediationPlan,
          sources,
          quality: qualityEvaluation.summary,
          perFindingQuality: qualityEvaluation.perFinding,
        })

    if (qualityEvaluation.summary.quality_status === "fail") {
      throw new Error(
        [
          "Report quality checks failed in strict mode.",
          ...qualityEvaluation.summary.quality_warnings.map((warning) => `- ${warning.message}`),
        ].join("\n"),
      )
    }

    if (requireAuthoredArtifacts) {
      const missing = [
        [reportPlanPath, existingReportPlan.trim()],
        [reportOutlinePath, existingReportOutline.trim()],
        [reportDraftPath, existingReportDraft.trim()],
        [reportRenderPlanPath, existingReportRenderPlan.trim()],
        [reportHtmlPath, existingReportHtml.trim()],
        [resultsPath, existingResults.trim()],
        [remediationPlanPath, existingRemediation.trim()],
        [reportPath, existingReport.trim()],
      ]
        .filter(([, content]) => !content)
        .map(([file]) => file)
      if (missing.length > 0) {
        throw new Error(
          [
            "Missing required authored report artifacts. report_finalize now validates/bundles model-authored outputs and will not auto-generate templates.",
            ...missing.map((file) => `- ${file}`),
          ].join("\n"),
        )
      }
    }

    await Promise.all([
      fs.writeFile(reportPlanPath, reportPlan),
      fs.writeFile(reportOutlinePath, reportOutline),
      fs.writeFile(reportDraftPath, reportDraft),
      fs.writeFile(resultsPath, resultsMarkdown),
      fs.writeFile(remediationPlanPath, remediationPlan),
      fs.writeFile(reportPath, finalReportMarkdown),
      fs.writeFile(findingsPath, JSON.stringify(findings, null, 2) + "\n"),
      fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n"),
      fs.writeFile(sourcesPath, JSON.stringify(sources, null, 2) + "\n"),
      fs.writeFile(timelinePath, JSON.stringify(timeline, null, 2) + "\n"),
      fs.writeFile(
        qualityChecksPath,
        JSON.stringify(
          {
            quality: qualityEvaluation.summary,
            findings: qualityEvaluation.perFinding,
            quality_mode: qualityMode,
          },
          null,
          2,
        ) + "\n",
      ),
    ])

    const authoredPdfExists = await fs
      .stat(pdfPath)
      .then((stat) => stat.isFile() && stat.size > 0)
      .catch(() => false)
    const pdf = authoredPdfExists
      ? { ok: true, message: "" }
      : (input.allowNoPdf ?? false)
        ? { ok: false, message: "No authored report.pdf found; allow_no_pdf=true accepted degraded mode." }
        : (() => {
            throw new Error(
              `report.pdf not found at ${pdfPath}. report_writer must generate a client-ready PDF before report_finalize.`,
            )
          })()

    return {
      sessionID: session.id,
      outDir: outputDir,
      reportPath,
      reportPdfPath: pdfPath,
      reportPlanPath,
      reportOutlinePath,
      reportDraftPath,
      reportRenderPlanPath,
      reportHtmlPath,
      resultsPath,
      remediationPlanPath,
      findingsPath,
      sourcesPath,
      timelinePath,
      qualityChecksPath,
      metadataPath,
      findingCount: findings.length,
      sourceCount: sources.length,
      subagentCount: subagentResults.length,
      pdfGenerated: pdf.ok,
      pdfMessage: pdf.message,
      quality: qualityEvaluation.summary,
      perFindingQuality: qualityEvaluation.perFinding,
    }
  }
}
