import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  ULM_HARNESS_REQUIRED_CAPABILITIES,
  createHarnessScenario,
  runHarnessScenarios,
  writeHarnessScorecard,
} from "@/ulm/harness"

describe("ULM harness scorecard", () => {
  test("tracks the ten required harness gaps as first-class capabilities", () => {
    expect(ULM_HARNESS_REQUIRED_CAPABILITIES.map((capability) => capability.id)).toEqual([
      "model_loop_eval",
      "restart_resume_chaos",
      "installed_profile_runtime",
      "ulm_ci_gate",
      "longitudinal_scorecard",
      "prompt_agent_regression",
      "provider_tool_chaos",
      "dashboard_api_e2e",
      "deep_lab_target",
      "adversarial_report_quality",
    ])
  })

  test("fails the scorecard when a required capability has no passing scenario", async () => {
    const result = await runHarnessScenarios([
      createHarnessScenario({
        id: "profile-runtime",
        title: "Installed profile runtime smoke",
        capability: "installed_profile_runtime",
        tier: "fast",
        run: async () => ({
          status: "passed",
          checks: [{ id: "profile-loaded", status: "passed", detail: "profile loaded from temp config" }],
          artifacts: [],
        }),
      }),
    ])

    expect(result.ok).toBe(false)
    expect(result.coverage.missing).toContain("model_loop_eval")
    expect(result.coverage.missing).toContain("adversarial_report_quality")
    expect(result.scenarios).toHaveLength(1)
    expect(result.scenarios[0]?.status).toBe("passed")
  })

  test("writes machine-readable and markdown scorecards", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-harness-scorecard-"))
    const result = await runHarnessScenarios(
      ULM_HARNESS_REQUIRED_CAPABILITIES.map((capability) =>
        createHarnessScenario({
          id: `${capability.id}-fixture`,
          title: capability.title,
          capability: capability.id,
          tier: "fast",
          run: async () => ({
            status: "passed",
            checks: [{ id: `${capability.id}-check`, status: "passed", detail: capability.detail }],
            artifacts: [{ label: "fixture", path: `${capability.id}.json`, kind: "json" }],
            metrics: { durationMs: 1 },
          }),
        }),
      ),
    )

    expect(result.ok).toBe(true)

    const written = await writeHarnessScorecard(dir, result)
    const json = JSON.parse(await fs.readFile(written.json, "utf8")) as typeof result
    const markdown = await fs.readFile(written.markdown, "utf8")

    expect(json.ok).toBe(true)
    expect(json.coverage.required).toHaveLength(10)
    expect(markdown).toContain("# ULM Harness Scorecard")
    expect(markdown).toContain("model_loop_eval")
    expect(markdown).toContain("adversarial_report_quality")
  })

  test("ships an eval scenario manifest for every required capability", async () => {
    const scenariosRoot = path.join(__dirname, "../../../..", "tools/ulmcode-evals/scenarios")
    const manifests = await Promise.all(
      ULM_HARNESS_REQUIRED_CAPABILITIES.map(async (capability) => {
        const manifestPath = path.join(scenariosRoot, `${capability.id}.json`)
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
          capability?: string
          tier?: string
          checks?: unknown[]
          acceptance?: string[]
        }
        return manifest
      }),
    )

    expect(manifests.map((manifest) => manifest.capability)).toEqual(
      ULM_HARNESS_REQUIRED_CAPABILITIES.map((capability) => capability.id),
    )
    expect(manifests.every((manifest) => manifest.tier === "fast")).toBe(true)
    expect(manifests.every((manifest) => (manifest.checks?.length ?? 0) >= 3)).toBe(true)
    expect(manifests.every((manifest) => (manifest.acceptance?.length ?? 0) >= 2)).toBe(true)
  })
})
