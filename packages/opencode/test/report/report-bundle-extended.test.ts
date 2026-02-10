import path from "path"
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ReportBundle } from "../../src/report/report"
import { CyberEnvironment } from "../../src/session/environment"

describe("report bundle extended artifacts", () => {
  test("writes sources, timeline, remediation plan, and draft artifacts", async () => {
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
        await Bun.write(
          path.join(env.root, "finding.md"),
          [
            "# Engagement Findings",
            "",
            "## Findings",
            "",
            "<!-- finding_json:{\"id\":\"FND-2\",\"title\":\"Open admin panel\",\"severity\":\"medium\",\"confidence\":0.7,\"asset\":\"admin.local\",\"evidence\":\"public endpoint\",\"impact\":\"admin abuse\",\"recommendation\":\"restrict access\",\"safe_reproduction_steps\":[\"open /admin\"],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )

        const outDir = path.join(env.root, "reports")
        const result = await ReportBundle.generate({
          sessionID: session.id,
          outDir,
          allowNoPdf: true,
        })

        expect(result.sourceCount).toBeGreaterThan(0)
        expect(await Bun.file(path.join(outDir, "sources.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "timeline.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "quality-checks.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "report-plan.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "report-outline.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "report-draft.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "remediation-plan.md")).exists()).toBe(true)
      },
    })
  })

  test("preserves authored report artifacts when present", async () => {
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
        await Bun.write(
          path.join(env.root, "finding.md"),
          [
            "# Engagement Findings",
            "",
            "## Findings",
            "",
            "<!-- finding_json:{\"id\":\"FND-2\",\"title\":\"Open admin panel\",\"severity\":\"medium\",\"confidence\":0.7,\"asset\":\"admin.local\",\"evidence\":\"public endpoint\",\"impact\":\"admin abuse\",\"recommendation\":\"restrict access\",\"safe_reproduction_steps\":[\"open /admin\"],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )

        const outDir = path.join(env.root, "reports")
        await Bun.write(path.join(outDir, "report-draft.md"), "# Draft Title\n\nDraft body that must stay intact.\n")
        await Bun.write(path.join(outDir, "report.md"), "# Final Title\n\nFinal body that must stay intact.\n")
        await Bun.write(path.join(outDir, "remediation-plan.md"), "# Remediation Plan\n\nCustom remediation steps.\n")

        const result = await ReportBundle.generate({
          sessionID: session.id,
          outDir,
          allowNoPdf: true,
        })

        expect(result.findingCount).toBe(1)
        expect(await Bun.file(path.join(outDir, "report-draft.md")).text()).toContain("Draft body that must stay intact.")
        expect(await Bun.file(path.join(outDir, "report.md")).text()).toContain("Final body that must stay intact.")
        expect(await Bun.file(path.join(outDir, "remediation-plan.md")).text()).toContain("Custom remediation steps.")
      },
    })
  })
})
