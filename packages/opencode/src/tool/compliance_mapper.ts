import fs from "fs/promises"
import z from "zod"
import { Tool } from "./tool"
import { loadInputItems } from "./defensive_data_adapter"

const FindingLike = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  finding_type: z.string().optional(),
  control_refs: z
    .array(
      z.object({
        framework: z.string(),
        control_id: z.string(),
      }),
    )
    .optional(),
})

const parameters = z.object({
  framework: z.string().describe("Target compliance framework (e.g. FERPA, CIS, NIST_CSF)"),
  findings: z.array(FindingLike).optional().describe("Inline findings list"),
  findings_file: z.string().optional().describe("Path to JSON array findings export"),
  finding_markdown: z
    .string()
    .optional()
    .describe("Optional path to finding.md to parse finding_json comments when findings/finding_file are omitted"),
})

function parseFindingJsonComments(markdown: string) {
  const parsed: z.infer<typeof FindingLike>[] = []
  const regex = /<!--\s*finding_json:(\{.*?\})\s*-->/g
  for (const match of markdown.matchAll(regex)) {
    try {
      parsed.push(FindingLike.parse(JSON.parse(match[1])))
    } catch {
      // ignore malformed blocks
    }
  }
  return parsed
}

export const ComplianceMapperTool = Tool.define("compliance_mapper", {
  description:
    "Map findings to compliance controls and generate a coverage summary with explicit unmapped gaps.",
  parameters,
  async execute(params) {
    let findings = await loadInputItems({
      items: params.findings,
      file: params.findings_file,
    }).then((list) => list.map((item) => FindingLike.parse(item)))

    if (findings.length === 0 && params.finding_markdown) {
      const markdown = await fs.readFile(params.finding_markdown, "utf8")
      findings = parseFindingJsonComments(markdown)
    }

    const relevant = findings.filter((f) =>
      (f.control_refs ?? []).some((ref) => ref.framework.toLowerCase() === params.framework.toLowerCase()),
    )

    const controlMap = new Map<string, string[]>()
    for (const finding of relevant) {
      for (const ref of finding.control_refs ?? []) {
        if (ref.framework.toLowerCase() !== params.framework.toLowerCase()) continue
        const current = controlMap.get(ref.control_id) ?? []
        current.push(finding.id)
        controlMap.set(ref.control_id, current)
      }
    }

    const unmapped = findings.filter((f) => (f.control_refs ?? []).length === 0)

    return {
      title: `Compliance mapping complete: ${params.framework}`,
      output: [
        `Framework: ${params.framework}`,
        `Findings analyzed: ${findings.length}`,
        `Mapped findings: ${relevant.length}`,
        `Unmapped findings: ${unmapped.length}`,
        `Controls touched: ${controlMap.size}`,
      ].join("\n"),
      metadata: {
        framework: params.framework,
        findings_analyzed: findings.length,
        mapped_findings: relevant.length,
        unmapped_findings: unmapped.map((f) => ({ id: f.id, title: f.title })),
        control_coverage: Array.from(controlMap.entries()).map(([control_id, finding_ids]) => ({
          control_id,
          finding_ids,
        })),
      },
    }
  },
})
