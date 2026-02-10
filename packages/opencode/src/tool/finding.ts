import path from "path"
import fs from "fs/promises"
import { ulid } from "ulid"
import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./finding.txt"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { CyberEnvironment } from "@/session/environment"

const Severity = z.enum(["critical", "high", "medium", "low", "info"])
const FindingType = z.enum([
  "vulnerability",
  "misconfiguration",
  "compliance_gap",
  "hardening_recommendation",
  "positive_control",
  "detection_gap",
  "policy_violation",
])
const ControlRef = z.object({
  framework: z.string().describe("Control framework name, e.g. CIS, NIST_CSF, FERPA"),
  control_id: z.string().describe("Control identifier, e.g. 5.2.1"),
  description: z.string().optional().describe("Optional human-friendly control description"),
})
const EvidenceRef = z.object({
  path: z.string().describe("Evidence file path (absolute or engagement-root relative)"),
  line_hint: z
    .string()
    .optional()
    .describe("Optional line hint such as ':42' or '#L42' to anchor the evidence location"),
})

const parameters = z.object({
  title: z.string().min(3).describe("Short finding title"),
  severity: Severity.describe("Risk severity"),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0 and 1"),
  asset: z.string().describe("Affected host, service, system, or asset identifier"),
  evidence: z.string().describe("Concrete evidence supporting the finding"),
  impact: z.string().describe("Likely impact if the issue is exploited"),
  recommendation: z.string().describe("Actionable remediation guidance"),
  finding_type: FindingType.default("vulnerability").describe("Finding category for offensive or defensive workflows"),
  control_refs: z.array(ControlRef).optional().describe("Optional compliance/control mappings for this finding"),
  baseline_state: z
    .string()
    .optional()
    .describe("Optional current observed baseline state (used for hardening/config drift reporting)"),
  expected_state: z
    .string()
    .optional()
    .describe("Optional expected baseline state (used for hardening/config drift reporting)"),
  positive_finding: z
    .boolean()
    .default(false)
    .describe("Set true when this finding documents a verified positive control that should be maintained"),
  evidence_refs: z
    .array(EvidenceRef)
    .optional()
    .describe("Optional structured evidence references used for report quality checks"),
  safe_reproduction_steps: z
    .array(z.string())
    .optional()
    .describe("Non-destructive reproduction/validation steps"),
  non_destructive: z
    .boolean()
    .default(true)
    .describe("Whether validation was performed non-destructively"),
})

type FindingInput = z.infer<typeof parameters>

function findingHeader(sessionID: string, agent: string, now: string) {
  return [
    "# Engagement Findings",
    "",
    `- Session: ${sessionID}`,
    `- Agent: ${agent}`,
    `- Started: ${now}`,
    "",
    "## Findings",
    "",
    "_Append each validated finding below with timestamp, asset, severity, confidence, evidence, impact, and remediation._",
    "",
  ].join("\n")
}

function findingBlock(input: FindingInput, now: string, id: string) {
  const normalized = {
    id,
    title: input.title.trim(),
    severity: input.severity,
    confidence: input.confidence,
    asset: input.asset.trim(),
    evidence: input.evidence.trim(),
    impact: input.impact.trim(),
    recommendation: input.recommendation.trim(),
    finding_type: input.finding_type,
    control_refs:
      input.control_refs
        ?.map((ref) => ({
          framework: ref.framework.trim(),
          control_id: ref.control_id.trim(),
          description: ref.description?.trim() || undefined,
        }))
        .filter((ref) => ref.framework.length > 0 && ref.control_id.length > 0) ?? [],
    baseline_state: input.baseline_state?.trim() || undefined,
    expected_state: input.expected_state?.trim() || undefined,
    positive_finding: input.positive_finding,
    evidence_refs:
      input.evidence_refs
        ?.map((ref) => ({
          path: ref.path.trim(),
          line_hint: ref.line_hint?.trim() || undefined,
        }))
        .filter((ref) => ref.path.length > 0) ?? [],
    safe_reproduction_steps: input.safe_reproduction_steps?.map((x) => x.trim()).filter(Boolean) ?? [],
    non_destructive: input.non_destructive,
    timestamp: now,
  }

  const steps =
    normalized.safe_reproduction_steps.length > 0
      ? normalized.safe_reproduction_steps.map((step, i) => `${i + 1}. ${step}`).join("\n")
      : "1. N/A"

  const evidenceRefs =
    normalized.evidence_refs.length > 0
      ? normalized.evidence_refs
          .map((ref) => `- ${ref.path}${ref.line_hint ? ` (${ref.line_hint})` : ""}`)
          .join("\n")
      : "- N/A"
  const controlRefs =
    normalized.control_refs.length > 0
      ? normalized.control_refs
          .map((ref) => `- ${ref.framework}:${ref.control_id}${ref.description ? ` - ${ref.description}` : ""}`)
          .join("\n")
      : "- N/A"

  return {
    id,
    payload: normalized,
    markdown: [
      `### [${normalized.id}] ${normalized.title}`,
      `- timestamp: ${normalized.timestamp}`,
      `- severity: ${normalized.severity}`,
      `- confidence: ${normalized.confidence}`,
      `- asset: ${normalized.asset}`,
      `- finding_type: ${normalized.finding_type}`,
      `- positive_finding: ${normalized.positive_finding ? "true" : "false"}`,
      `- non_destructive: ${normalized.non_destructive ? "true" : "false"}`,
      "",
      "#### Control References",
      controlRefs,
      "",
      "#### Baseline Delta",
      `- current_state: ${normalized.baseline_state ?? "N/A"}`,
      `- expected_state: ${normalized.expected_state ?? "N/A"}`,
      "",
      "#### Evidence",
      normalized.evidence,
      "",
      "#### Evidence References",
      evidenceRefs,
      "",
      "#### Impact",
      normalized.impact,
      "",
      "#### Recommendation",
      normalized.recommendation,
      "",
      "#### Safe Reproduction Steps",
      steps,
      "",
      `<!-- finding_json:${JSON.stringify(normalized)} -->`,
      "",
    ].join("\n"),
  }
}

export const FindingTool = Tool.define("finding", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const now = new Date().toISOString()
    const session = await Session.get(ctx.sessionID)
    const file = CyberEnvironment.resolveFindingPath(session)
    const relative = path.relative(Instance.directory, file)
    const id = "FND-" + ulid().slice(-10)

    await ctx.ask({
      permission: "finding",
      patterns: [relative, file],
      always: [relative, file],
      metadata: {
        title: params.title,
        severity: params.severity,
        asset: params.asset,
      },
    })

    try {
      await fs.access(file)
    } catch {
      await fs.writeFile(file, findingHeader(ctx.sessionID, ctx.agent, now), { flag: "wx" }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return
        throw error
      })
    }

    const block = findingBlock(params, now, id)
    await fs.appendFile(file, block.markdown)

    return {
      title: `Logged finding ${id}`,
      output: `Appended finding to ${file}`,
      metadata: {
        file,
        finding: block.payload,
      },
    }
  },
})
