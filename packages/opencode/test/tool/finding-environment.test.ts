import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { FindingTool } from "../../src/tool/finding"
import { CyberEnvironment } from "../../src/session/environment"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

const baseCtx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "pentest",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

describe("tool.finding environment routing", () => {
  test("writes finding.md to engagement root when environment exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Cyber run" })
        const env = CyberEnvironment.create(session)
        await Session.update(session.id, (draft) => {
          draft.environment = env
        })
        await CyberEnvironment.ensureSharedScaffold({ environment: env, session })

        const tool = await FindingTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const result = await tool.execute(
          {
            title: "Weak config",
            severity: "medium",
            confidence: 0.8,
            asset: "srv01",
            evidence: "Evidence",
            impact: "Impact",
            recommendation: "Fix it",
            finding_type: "vulnerability",
            positive_finding: false,
            safe_reproduction_steps: ["Check config"],
            non_destructive: true,
          },
          {
            ...baseCtx,
            sessionID: session.id,
            ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
              requests.push(req)
            },
          },
        )

        const findingPath = path.join(env.root, "finding.md")
        const log = await Bun.file(findingPath).text()
        expect(result.metadata.file).toBe(findingPath)
        expect(log).toContain("Weak config")
        expect(requests[0].patterns).toContain(path.relative(tmp.path, findingPath))
      },
    })
  })

  test("falls back to project finding.md when environment is absent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Legacy run" })
        const tool = await FindingTool.init()
        await tool.execute(
          {
            title: "Legacy finding",
            severity: "low",
            confidence: 0.3,
            asset: "legacy",
            evidence: "Evidence",
            impact: "Impact",
            recommendation: "Fix it",
            finding_type: "vulnerability",
            positive_finding: false,
            safe_reproduction_steps: [],
            non_destructive: true,
          },
          {
            ...baseCtx,
            sessionID: session.id,
            ask: async () => {},
          },
        )

        expect(await Bun.file(path.join(tmp.path, "finding.md")).exists()).toBe(true)
      },
    })
  })
})
