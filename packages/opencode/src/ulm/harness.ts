import fs from "fs/promises"
import path from "path"

export const ULM_HARNESS_REQUIRED_CAPABILITIES = [
  {
    id: "model_loop_eval",
    title: "Model-in-the-loop operation eval",
    detail: "Exercises prompts, tools, and discovery flow instead of only replaying fixture artifacts.",
  },
  {
    id: "restart_resume_chaos",
    title: "Restart and resume chaos drill",
    detail: "Verifies operation recovery after stale lanes, process interruption, or partial runtime state.",
  },
  {
    id: "installed_profile_runtime",
    title: "Installed profile runtime smoke",
    detail: "Loads ULMCode from an installed temp profile rather than only repo-local files.",
  },
  {
    id: "ulm_ci_gate",
    title: "First-class ULM CI gate",
    detail: "Keeps ULM-specific checks visible as named CI jobs.",
  },
  {
    id: "longitudinal_scorecard",
    title: "Longitudinal scorecard",
    detail: "Emits durable run metrics for trend and regression review.",
  },
  {
    id: "prompt_agent_regression",
    title: "Prompt and agent regression fixtures",
    detail: "Checks bad transcript patterns such as sparse reporting and skipped planning.",
  },
  {
    id: "provider_tool_chaos",
    title: "Provider and tool chaos fixtures",
    detail: "Covers malformed streams, provider overload, and degraded tool availability.",
  },
  {
    id: "dashboard_api_e2e",
    title: "Dashboard and API end-to-end state",
    detail: "Verifies operator-visible state matches persisted operation artifacts.",
  },
  {
    id: "deep_lab_target",
    title: "Deep lab target harness",
    detail: "Exercises target realism beyond shallow health and vulnerable endpoint probes.",
  },
  {
    id: "adversarial_report_quality",
    title: "Adversarial report-quality gate",
    detail: "Rejects sparse, unsupported, or miscited reports before final handoff.",
  },
] as const

export type HarnessCapabilityID = (typeof ULM_HARNESS_REQUIRED_CAPABILITIES)[number]["id"]
export type HarnessTier = "fast" | "full" | "chaos" | "nightly"
export type HarnessCheckStatus = "passed" | "failed" | "skipped"
export type HarnessScenarioStatus = HarnessCheckStatus

export type HarnessArtifact = {
  label: string
  path: string
  kind?: "json" | "markdown" | "html" | "pdf" | "log" | "text" | "directory"
}

export type HarnessCheck = {
  id: string
  status: HarnessCheckStatus
  detail: string
}

export type HarnessMetrics = {
  durationMs?: number
  checks?: number
  warnings?: number
  artifacts?: number
  [key: string]: number | undefined
}

export type HarnessScenarioContext = {
  runID: string
  startedAt: string
  outputDir?: string
}

export type HarnessScenarioRunResult = {
  status: HarnessScenarioStatus
  checks: HarnessCheck[]
  artifacts?: HarnessArtifact[]
  metrics?: HarnessMetrics
  notes?: string[]
}

export type HarnessScenario = {
  id: string
  title: string
  capability: HarnessCapabilityID
  tier: HarnessTier
  description?: string
  run: (context: HarnessScenarioContext) => Promise<HarnessScenarioRunResult>
}

export type HarnessScenarioResult = Omit<HarnessScenario, "run"> &
  HarnessScenarioRunResult & {
    durationMs: number
    error?: string
  }

export type HarnessRunResult = {
  ok: boolean
  runID: string
  startedAt: string
  finishedAt: string
  durationMs: number
  coverage: {
    required: HarnessCapabilityID[]
    passed: HarnessCapabilityID[]
    failed: HarnessCapabilityID[]
    missing: HarnessCapabilityID[]
  }
  scenarios: HarnessScenarioResult[]
}

export function createHarnessScenario(input: HarnessScenario): HarnessScenario {
  const known = new Set(ULM_HARNESS_REQUIRED_CAPABILITIES.map((capability) => capability.id))
  if (!known.has(input.capability)) {
    throw new Error(`Unknown ULM harness capability: ${input.capability}`)
  }
  return input
}

export async function runHarnessScenarios(
  scenarios: HarnessScenario[],
  options: { runID?: string; outputDir?: string; now?: Date } = {},
): Promise<HarnessRunResult> {
  const started = options.now ?? new Date()
  const runID = options.runID ?? `ulm-harness-${started.toISOString().replace(/[:.]/g, "-")}`
  const context: HarnessScenarioContext = {
    runID,
    startedAt: started.toISOString(),
    outputDir: options.outputDir,
  }
  const results: HarnessScenarioResult[] = []

  for (const scenario of scenarios) {
    const scenarioStart = Date.now()
    try {
      const result = await scenario.run(context)
      const failedCheck = result.checks.some((check) => check.status === "failed")
      results.push({
        id: scenario.id,
        title: scenario.title,
        capability: scenario.capability,
        tier: scenario.tier,
        description: scenario.description,
        ...result,
        status: failedCheck && result.status === "passed" ? "failed" : result.status,
        durationMs: Date.now() - scenarioStart,
      })
    } catch (error) {
      results.push({
        id: scenario.id,
        title: scenario.title,
        capability: scenario.capability,
        tier: scenario.tier,
        description: scenario.description,
        status: "failed",
        checks: [
          {
            id: "scenario-error",
            status: "failed",
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
        artifacts: [],
        notes: [],
        metrics: {},
        durationMs: Date.now() - scenarioStart,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      })
    }
  }

  const required = ULM_HARNESS_REQUIRED_CAPABILITIES.map((capability) => capability.id)
  const passed = required.filter((capability) =>
    results.some((result) => result.capability === capability && result.status === "passed"),
  )
  const failed = required.filter((capability) =>
    results.some((result) => result.capability === capability && result.status === "failed"),
  )
  const missing = required.filter((capability) => !passed.includes(capability))
  const finished = new Date()

  return {
    ok: missing.length === 0 && results.every((result) => result.status === "passed"),
    runID,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    coverage: { required, passed, failed, missing },
    scenarios: results,
  }
}

export async function writeHarnessScorecard(outputDir: string, result: HarnessRunResult) {
  await fs.mkdir(outputDir, { recursive: true })
  const json = path.join(outputDir, "scorecard.json")
  const markdown = path.join(outputDir, "scorecard.md")
  await fs.writeFile(json, JSON.stringify(result, null, 2))
  await fs.writeFile(markdown, formatHarnessScorecard(result))
  return { json, markdown }
}

export function formatHarnessScorecard(result: HarnessRunResult) {
  const lines = [
    "# ULM Harness Scorecard",
    "",
    `- Run: ${result.runID}`,
    `- Status: ${result.ok ? "ok" : "failed"}`,
    `- Started: ${result.startedAt}`,
    `- Finished: ${result.finishedAt}`,
    `- Duration: ${result.durationMs}ms`,
    "",
    "## Coverage",
    "",
    `- Required: ${result.coverage.required.length}`,
    `- Passed: ${result.coverage.passed.length}`,
    `- Failed: ${result.coverage.failed.length}`,
    `- Missing: ${result.coverage.missing.length ? result.coverage.missing.join(", ") : "none"}`,
    "",
    "## Scenarios",
    "",
  ]

  for (const scenario of result.scenarios) {
    lines.push(`### ${scenario.id}`)
    lines.push("")
    lines.push(`- Capability: ${scenario.capability}`)
    lines.push(`- Tier: ${scenario.tier}`)
    lines.push(`- Status: ${scenario.status}`)
    lines.push(`- Checks: ${scenario.checks.length}`)
    for (const check of scenario.checks) {
      lines.push(`  - ${check.status}: ${check.id} - ${check.detail}`)
    }
    if (scenario.notes?.length) {
      lines.push(`- Notes: ${scenario.notes.join("; ")}`)
    }
    lines.push("")
  }

  return `${lines.join("\n").trimEnd()}\n`
}
