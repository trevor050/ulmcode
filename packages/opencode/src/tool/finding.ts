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

  return {
    id,
    payload: normalized,
    markdown: [
      `### [${normalized.id}] ${normalized.title}`,
      `- timestamp: ${normalized.timestamp}`,
      `- severity: ${normalized.severity}`,
      `- confidence: ${normalized.confidence}`,
      `- asset: ${normalized.asset}`,
      `- non_destructive: ${normalized.non_destructive ? "true" : "false"}`,
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
