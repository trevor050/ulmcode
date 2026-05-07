import { describe, expect, test } from "bun:test"
import { evaluateRuntimeGovernor, writeRuntimeGovernorRouteAudit } from "@/ulm/runtime-governor"
import { writeOperationCheckpoint, writeRuntimeSummary } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { tmpdir } from "../fixture/fixture"

describe("ULM runtime governor", () => {
  test("continues a ready lane when runtime budget and context are healthy", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationCheckpoint(dir.path, {
      operationID: "School",
      objective: "Authorized school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon running.",
    })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const decision = await evaluateRuntimeGovernor(dir.path, { operationID: "School", laneID: "recon" })

    expect(decision.action).toBe("continue")
    expect(decision.modelRoute).toContain("/")
    expect(decision.remainingUSD).toBe(9)
    expect(decision.blockers).toEqual([])
  })

  test("stops when operation budget is exhausted", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 5 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 5.25, budgetUSD: 5 },
      compaction: { pressure: "moderate" },
    })

    const decision = await evaluateRuntimeGovernor(dir.path, { operationID: "School", laneID: "recon" })

    expect(decision.action).toBe("stop")
    expect(decision.blockers).toContain("operation budget exhausted")
    expect(decision.recommendedTools).toContain("operation_audit")
  })

  test("uses lane-specific spend before shared agent spend", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: {
        costUSD: 2,
        budgetUSD: 10,
        byAgent: { recon: { costUSD: 99 } },
        byLane: { recon: { costUSD: 0.5 } },
      },
      compaction: { pressure: "low" },
    })

    const decision = await evaluateRuntimeGovernor(dir.path, { operationID: "School", laneID: "recon" })

    expect(decision.action).toBe("continue")
    expect(decision.blockers).not.toContain("lane budget exhausted for recon")
  })

  test("compacts when projected context approaches the lane model limit", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10, totalTokens: 190_000 },
      compaction: { pressure: "low" },
    })

    const decision = await evaluateRuntimeGovernor(dir.path, { operationID: "School", laneID: "recon" })

    expect(decision.action).toBe("compact")
    expect(decision.contextRatio).toBeGreaterThanOrEqual(0.9)
    expect(decision.blockers).toContain("model context is above 90% for opencode-go/default")
  })

  test("requires model metadata for unknown routes", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, {
      operationID: "School",
      budgetUSD: 10,
      modelRoutes: { throughput: "unknown-provider/mystery-model" },
    })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const decision = await evaluateRuntimeGovernor(dir.path, { operationID: "School", laneID: "recon" })

    expect(decision.action).toBe("compact")
    expect(decision.blockers).toContain("model route metadata is missing for unknown-provider/mystery-model")
  })

  test("stops hard-quota lanes before relaunching an exhausted model route", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, {
      operationID: "School",
      budgetUSD: 10,
      modelRoutes: { throughput: "opencode-go/default" },
    })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      modelCalls: {
        total: 4,
        byModel: { "opencode-go/default": 4 },
      },
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const decision = await evaluateRuntimeGovernor(dir.path, {
      operationID: "School",
      laneID: "recon",
      modelCatalog: {
        "opencode-go/default": {
          providerKind: "subscription",
          contextLimit: 200_000,
          outputLimit: 32_000,
          quota: { kind: "hard", window: "daily", maxCalls: 4 },
        },
      },
    })

    expect(decision.action).toBe("stop")
    expect(decision.blockers).toContain("model route quota exhausted for opencode-go/default")
    expect(decision.fallbackModelRoutes).toContain("openai/gpt-5.4-mini-fast")
    expect(decision.recommendedTools).toContain("runtime_summary")
    expect(decision.recommendedTools).toContain("operation_audit")
  })

  test("requests compaction when graph or runtime summary is missing", async () => {
    await using dir = await tmpdir({ git: true })

    const decision = await evaluateRuntimeGovernor(dir.path, { operationID: "School" })

    expect(decision.action).toBe("compact")
    expect(decision.blockers).toEqual(["operation graph is missing", "runtime summary is missing"])
    expect(decision.recommendedTools).toContain("operation_schedule")
  })

  test("writes a durable model route audit for primary and fallback lane routes", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })

    const audit = await writeRuntimeGovernorRouteAudit(dir.path, {
      operationID: "School",
      providers: {
        openai: {
          source: "env",
          models: {
            "gpt-5.5-fast": { limit: { context: 1_000_000, output: 128_000 } },
            "gpt-5.4-mini-fast": { limit: { context: 270_000, output: 64_000 } },
          },
        },
        "opencode-go": {
          source: "custom",
          models: {
            default: { limit: { context: 200_000, output: 32_000 } },
          },
        },
      },
      quotaOverrides: {
        "opencode-go/default": { kind: "soft", window: "daily", maxCalls: 20 },
      },
    })

    expect(audit.json).toContain("model-route-audit.json")
    expect(audit.markdown).toContain("model-route-audit.md")
    expect(audit.record.routes.some((route) => route.role === "fallback")).toBe(true)
    expect(audit.record.routes.some((route) => route.route === "opencode-go/default" && route.quotaPolicyKnown)).toBe(true)
    expect(await Bun.file(audit.markdown).text()).toContain("quota policy is not recorded")
  })
})
