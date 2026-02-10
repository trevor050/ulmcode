import z from "zod"
import { Tool } from "./tool"
import { loadInputItems } from "./defensive_data_adapter"

const Technique = z.object({
  id: z.string().min(1).describe("MITRE ATT&CK technique ID"),
  name: z.string().optional(),
})

const DetectionRule = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  techniques: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
})

const parameters = z.object({
  techniques: z.array(Technique).optional().describe("Techniques to validate coverage for"),
  techniques_file: z.string().optional().describe("Path to JSON array of techniques"),
  detection_rules: z.array(DetectionRule).optional().describe("Detection rules inventory"),
  detection_rules_file: z.string().optional().describe("Path to JSON array of detection rules"),
})

export const DetectionValidatorTool = Tool.define("detection_validator", {
  description: "Validate ATT&CK technique coverage against available detection rules and identify blind spots.",
  parameters,
  async execute(params) {
    const techniques = await loadInputItems({
      items: params.techniques,
      file: params.techniques_file,
    }).then((list) => list.map((item) => Technique.parse(item)))

    const rules = await loadInputItems({
      items: params.detection_rules,
      file: params.detection_rules_file,
    }).then((list) => list.map((item) => DetectionRule.parse(item)))

    const enabledRules = rules.filter((rule) => rule.enabled)
    const coverage = techniques.map((technique) => {
      const matched = enabledRules.filter((rule) => rule.techniques.includes(technique.id))
      return {
        technique_id: technique.id,
        technique_name: technique.name,
        covered: matched.length > 0,
        rules: matched.map((rule) => ({ id: rule.id, name: rule.name })),
      }
    })

    const coveredCount = coverage.filter((item) => item.covered).length
    const gapCount = coverage.length - coveredCount
    const ratio = coverage.length === 0 ? 0 : coveredCount / coverage.length

    return {
      title: "Detection coverage validation complete",
      output: [
        `Techniques analyzed: ${coverage.length}`,
        `Enabled rules analyzed: ${enabledRules.length}`,
        `Covered techniques: ${coveredCount}`,
        `Coverage gaps: ${gapCount}`,
        `Coverage ratio: ${Math.round(ratio * 1000) / 10}%`,
      ].join("\n"),
      metadata: {
        techniques_analyzed: coverage.length,
        enabled_rules_analyzed: enabledRules.length,
        covered_techniques: coveredCount,
        uncovered_techniques: coverage.filter((item) => !item.covered),
        coverage_ratio: ratio,
        coverage,
      },
    }
  },
})
