import { describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { CyberEnvironment } from "../../src/session/environment"
import { tmpdir } from "../fixture/fixture"

describe("report_writer skill autoload contract", () => {
  test("report_writer prompt explicitly requires deterministic skill loading", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("report_writer")
        expect(agent?.prompt).toContain('skill({"name":"k12-risk-mapping-and-reporting"})')
        expect(agent?.prompt).toContain("step-by-step synthesis")
      },
    })
  })

  test("skill warning marker is stable", () => {
    expect(CyberEnvironment.REPORT_WRITER_SKILL_MARKER).toBe("[REPORT_WRITER_SKILL_REQUIRED_V1]")
  })
})
