import z from "zod"
import { Tool } from "./tool"
import { loadInputItems } from "./defensive_data_adapter"

const BaselineObservation = z.object({
  control_id: z.string().min(1),
  current_state: z.string().min(1),
  expected_state: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low", "info"]).default("medium"),
  evidence: z.string().optional(),
  recommendation: z.string().optional(),
})

const parameters = z.object({
  target: z.string().min(1).describe("Target system, host group, or environment label"),
  framework: z.string().default("CIS").describe("Baseline framework name, e.g. CIS, STIG, NIST"),
  observations: z.array(BaselineObservation).optional().describe("Inline baseline observations"),
  observations_file: z.string().optional().describe("Path to JSON array of baseline observations"),
})

export const BaselineCheckTool = Tool.define("baseline_check", {
  description:
    "Evaluate baseline and hardening observations, identify control drift, and output structured remediation-ready gaps.",
  parameters,
  async execute(params) {
    const observations = await loadInputItems({
      items: params.observations,
      file: params.observations_file,
    }).then((list) => list.map((item) => BaselineObservation.parse(item)))

    const gaps = observations.filter((item) => item.current_state.trim() !== item.expected_state.trim())
    const passed = observations.length - gaps.length

    const findings = gaps.map((gap, idx) => ({
      id: `BASE-${idx + 1}`,
      title: `${params.framework} control drift: ${gap.control_id}`,
      finding_type: "hardening_recommendation",
      severity: gap.severity,
      confidence: 0.85,
      asset: params.target,
      baseline_state: gap.current_state,
      expected_state: gap.expected_state,
      impact: "Configuration drift weakens defensive baseline and can increase exploitability or compliance risk.",
      recommendation: gap.recommendation ?? `Align ${gap.control_id} with ${params.framework} baseline requirement.`,
      evidence: gap.evidence ?? `Observed state for ${gap.control_id}: ${gap.current_state}`,
      control_refs: [{ framework: params.framework, control_id: gap.control_id }],
      positive_finding: false,
    }))

    return {
      title: `Baseline check complete: ${params.target}`,
      output: [
        `Target: ${params.target}`,
        `Framework: ${params.framework}`,
        `Total controls reviewed: ${observations.length}`,
        `Passed controls: ${passed}`,
        `Gap count: ${gaps.length}`,
        "",
        "Suggested findings (use finding tool to log):",
        ...findings.map((item) => `- ${item.title} [${item.severity}]`),
      ].join("\n"),
      metadata: {
        framework: params.framework,
        target: params.target,
        total_controls: observations.length,
        passed_controls: passed,
        gap_count: gaps.length,
        suggested_findings: findings,
      },
    }
  },
})
