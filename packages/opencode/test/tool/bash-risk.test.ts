import { describe, expect, test } from "bun:test"
import { BashRisk } from "../../src/tool/bash-risk"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "pentest",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.bash-risk classify", () => {
  test("classifies clearly destructive command as sensitive", () => {
    const result = BashRisk.classify("rm -rf /")
    expect(result.level).toBe("sensitive")
    if (result.level === "sensitive") {
      expect(result.match.matched_rule).toBe("rm-recursive-force")
    }
  })

  test("classifies packet filter flush as sensitive", () => {
    const result = BashRisk.classify("iptables -F")
    expect(result.level).toBe("sensitive")
    if (result.level === "sensitive") {
      expect(result.match.matched_rule).toBe("firewall-disruption")
    }
  })

  test("classifies normal recon command as low", () => {
    const result = BashRisk.classify("nmap -sV 10.10.0.0/24")
    expect(result.level).toBe("low")
  })
})

describe("tool.bash sensitive permission metadata", () => {
  test("includes reason, rule, preview, and engagement context", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        await bash.execute(
          {
            command: "iptables -F",
            description: "Flush firewall chains",
          },
          testCtx,
        )

        const sensitive = requests.find((r) => r.permission === "bash_sensitive")
        expect(sensitive).toBeDefined()
        expect(sensitive?.metadata?.reason).toBeDefined()
        expect(sensitive?.metadata?.matched_rule).toBe("firewall-disruption")
        expect(sensitive?.metadata?.command_preview).toBe("iptables -F")
        expect(sensitive?.metadata?.engagement_context?.agent).toBe("pentest")
      },
    })
  })
})
