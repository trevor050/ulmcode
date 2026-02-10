import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { FindingTool } from "../../src/tool/finding"
import { CyberEnvironment } from "../../src/session/environment"
import { tmpdir } from "../fixture/fixture"

describe("tool.finding defensive fields", () => {
  test("persists finding_type, control refs, and baseline delta", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Defensive finding" })
        const env = CyberEnvironment.create(session)
        await Session.update(session.id, (draft) => {
          draft.environment = env
        })
        await CyberEnvironment.ensureSharedScaffold({ environment: env, session })

        const tool = await FindingTool.init()
        await tool.execute(
          {
            title: "FERPA control evidence missing",
            severity: "high",
            confidence: 0.82,
            asset: "district-sis",
            evidence: "No linked audit evidence for record access logs",
            impact: "Compliance gap",
            recommendation: "Map logs to FERPA controls and retain export evidence",
            finding_type: "compliance_gap",
            control_refs: [{ framework: "FERPA", control_id: "A-1", description: "Access logging" }],
            baseline_state: "No packaged audit proof",
            expected_state: "Audit export linked in engagement artifacts",
            positive_finding: false,
            safe_reproduction_steps: ["Review control evidence package"],
            non_destructive: true,
          },
          {
            sessionID: session.id,
            messageID: "",
            callID: "",
            agent: "pentest",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
        )

        const findingPath = path.join(env.root, "finding.md")
        const content = await Bun.file(findingPath).text()
        expect(content).toContain("finding_type: compliance_gap")
        expect(content).toContain("FERPA:A-1")
        expect(content).toContain("current_state: No packaged audit proof")
        expect(content).toContain("expected_state: Audit export linked in engagement artifacts")
        expect(content).toContain('"finding_type":"compliance_gap"')
      },
    })
  })
})
