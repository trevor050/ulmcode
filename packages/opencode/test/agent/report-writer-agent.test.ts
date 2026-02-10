import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { tmpdir } from "../fixture/fixture"

describe("agent.report_writer", () => {
  test("uses dedicated report_writer prompt and permissions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("report_writer")
        expect(agent).toBeDefined()
        expect(agent?.prompt).toContain("FIRST TOOL CALL MUST BE")
        expect(agent?.prompt).toContain("report_finalize")
        expect(agent?.hidden).toBeUndefined()

        const perms = agent!.permission
        const evalPerm = (permission: string) =>
          perms.find((rule) => rule.permission === permission && rule.pattern === "*")?.action

        expect(evalPerm("write")).toBe("allow")
        expect(evalPerm("edit")).toBe("allow")
        expect(evalPerm("task")).toBe("deny")
      },
    })
  })
})
