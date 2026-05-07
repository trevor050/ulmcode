import { describe, expect } from "bun:test"
import { Agent } from "@/agent/agent"
import { ToolRegistry } from "@/tool/registry"
import { testEffect } from "../lib/effect"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("ULM native surface", () => {
  it.instance("registers rebuilt ULM agents", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const names = (yield* agent.list()).map((item) => item.name)
      expect(names).toContain("pentest")
      expect(names).toContain("recon")
      expect(names).toContain("person-recon")
      expect(names).toContain("attack-map")
      expect(names).toContain("validator")
      expect(names).toContain("evidence")
      expect(names).toContain("report-writer")
      expect(names).toContain("report-reviewer")
    }))

  it.instance("registers rebuilt ULM operation tools", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("operation_audit")
      expect(ids).toContain("operation_checkpoint")
      expect(ids).toContain("operation_plan")
      expect(ids).toContain("operation_recover")
      expect(ids).toContain("operation_status")
      expect(ids).toContain("operation_stage_gate")
      expect(ids).toContain("district_profile")
      expect(ids).toContain("evidence_record")
      expect(ids).toContain("identity_graph")
      expect(ids).toContain("person_profile")
      expect(ids).toContain("task_restart")
      expect(ids).toContain("task_status")
      expect(ids).toContain("finding_record")
      expect(ids).toContain("report_lint")
      expect(ids).toContain("report_outline")
      expect(ids).toContain("report_render")
      expect(ids).toContain("runtime_summary")
      expect(ids).toContain("eval_scorecard")
    }))
})
