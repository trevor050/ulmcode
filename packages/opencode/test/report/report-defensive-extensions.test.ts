import path from "path"
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { CyberEnvironment } from "../../src/session/environment"
import { ReportBundle } from "../../src/report/report"

describe("report defensive extensions", () => {
  test("surfaces warnings for compliance findings without control refs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Defensive report run" })
        const env = CyberEnvironment.create(session)
        await Session.update(session.id, (draft) => {
          draft.environment = env
        })
        await CyberEnvironment.ensureSharedScaffold({ environment: env, session })

        await Bun.write(
          path.join(env.root, "finding.md"),
          [
            "# Engagement Findings",
            "",
            "## Findings",
            "",
            "<!-- finding_json:{\"id\":\"FND-COMP-1\",\"title\":\"FERPA control gap\",\"severity\":\"high\",\"confidence\":0.8,\"asset\":\"district-sis\",\"evidence\":\"missing audit evidence\",\"impact\":\"audit failure risk\",\"recommendation\":\"map controls\",\"finding_type\":\"compliance_gap\",\"safe_reproduction_steps\":[],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )

        const result = await ReportBundle.generate({
          sessionID: session.id,
          allowNoPdf: true,
        })

        expect(result.quality.quality_warnings.some((w) => w.code === "missing_control_refs")).toBe(true)
      },
    })
  })

  test("parses baseline metadata and positive controls", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Defensive report parse" })
        const env = CyberEnvironment.create(session)
        await Session.update(session.id, (draft) => {
          draft.environment = env
        })
        await CyberEnvironment.ensureSharedScaffold({ environment: env, session })

        await Bun.write(
          path.join(env.root, "finding.md"),
          [
            "# Engagement Findings",
            "",
            "## Findings",
            "",
            "<!-- finding_json:{\"id\":\"FND-BL-1\",\"title\":\"MFA enforcement present\",\"severity\":\"info\",\"confidence\":0.9,\"asset\":\"entra-id\",\"evidence\":\"all admin roles require MFA\",\"impact\":\"risk reduced\",\"recommendation\":\"maintain policy\",\"finding_type\":\"positive_control\",\"positive_finding\":true,\"baseline_state\":\"MFA required\",\"expected_state\":\"MFA required\",\"control_refs\":[{\"framework\":\"CIS\",\"control_id\":\"6.3\"}],\"safe_reproduction_steps\":[],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )

        await ReportBundle.generate({
          sessionID: session.id,
          allowNoPdf: true,
        })

        const findings = (await Bun.file(path.join(env.root, "reports", "findings.json")).json()) as Array<{
          finding_type: string
          positive_finding: boolean
          baseline_state?: string
          expected_state?: string
          control_refs: Array<{ framework: string; control_id: string }>
        }>
        expect(findings[0].finding_type).toBe("positive_control")
        expect(findings[0].positive_finding).toBe(true)
        expect(findings[0].baseline_state).toBe("MFA required")
        expect(findings[0].expected_state).toBe("MFA required")
        expect(findings[0].control_refs[0].framework).toBe("CIS")
      },
    })
  })
})
