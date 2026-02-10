import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ReportBundle } from "../../src/report/report"
import { CyberEnvironment } from "../../src/session/environment"

describe("report bundle", () => {
  test("writes markdown + findings json + run metadata without explicit outDir", async () => {
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
            "### [FND-123] Weak SMB signing",
            "- severity: high",
            "",
            "<!-- finding_json:{\"id\":\"FND-123\",\"title\":\"Weak SMB signing\",\"severity\":\"high\",\"confidence\":0.9,\"asset\":\"dc01.school.local\",\"evidence\":\"SMB signing optional\",\"impact\":\"relay risk\",\"recommendation\":\"enforce SMB signing\",\"safe_reproduction_steps\":[\"Run smb security mode\"],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )

        const result = await ReportBundle.generate({
          sessionID: session.id,
          allowNoPdf: true,
        })

        expect(result.findingCount).toBe(1)
        expect(result.outDir).toBe(path.join(env.root, "reports"))
        expect(await Bun.file(path.join(env.root, "reports", "report.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "reports", "findings.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "reports", "run-metadata.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "reports", "quality-checks.json")).exists()).toBe(true)

        const markdown = await Bun.file(path.join(env.root, "reports", "report.md")).text()
        expect(markdown).toContain("Client Pentest Report")
        expect(markdown).toContain("## Findings")
        expect(markdown).toContain("## Remediation Plan")

        const findings = (await Bun.file(path.join(env.root, "reports", "findings.json")).json()) as unknown[]
        expect(findings.length).toBe(1)
        const quality = (await Bun.file(path.join(env.root, "reports", "quality-checks.json")).json()) as {
          quality: { quality_status: string }
        }
        expect(["pass", "warn"]).toContain(quality.quality.quality_status)

        const metadata = (await Bun.file(path.join(env.root, "reports", "run-metadata.json")).json()) as {
          session_id: string
        }
        expect(metadata.session_id).toBe(session.id)
      },
    })
  })

  test("lazily creates environment and migrates legacy finding log", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Legacy run" })
        const legacyPath = path.join(tmp.path, "finding.md")
        await Bun.write(
          legacyPath,
          [
            "# Engagement Findings",
            "",
            "## Findings",
            "",
            "<!-- finding_json:{\"id\":\"FND-1\",\"title\":\"Legacy finding\",\"severity\":\"low\",\"confidence\":0.4,\"asset\":\"host\",\"evidence\":\"e\",\"impact\":\"i\",\"recommendation\":\"r\",\"safe_reproduction_steps\":[],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )

        const result = await ReportBundle.generate({ sessionID: session.id, allowNoPdf: true })
        const updated = await Session.get(session.id)
        expect(updated.environment).toBeDefined()
        expect(result.outDir).toBe(path.join(updated.environment!.root, "reports"))
        expect(await Bun.file(path.join(updated.environment!.root, "finding.md")).exists()).toBe(true)
      },
    })
  })

  test("uses top-level session metadata when invoked from child report_writer session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "Parent pentest" })
        const env = CyberEnvironment.create(parent)
        await Session.update(parent.id, (draft) => {
          draft.environment = env
        })
        await CyberEnvironment.ensureSharedScaffold({ environment: env, session: parent })
        await Bun.write(
          path.join(env.root, "finding.md"),
          [
            "# Engagement Findings",
            "",
            "## Findings",
            "",
            "<!-- finding_json:{\"id\":\"FND-ROOT\",\"title\":\"Root-level issue\",\"severity\":\"low\",\"confidence\":0.6,\"asset\":\"host\",\"evidence\":\"e\",\"impact\":\"i\",\"recommendation\":\"r\",\"safe_reproduction_steps\":[],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )

        const child = await Session.create({ parentID: parent.id, title: "Child report writer" })

        const result = await ReportBundle.generate({
          sessionID: child.id,
          allowNoPdf: true,
        })

        const markdown = await Bun.file(path.join(env.root, "reports", "report.md")).text()
        expect(result.sessionID).toBe(parent.id)
        expect(markdown).toContain(`- Session: ${parent.id}`)
        expect(markdown).not.toContain(`- Session: ${child.id}`)

        const metadata = (await Bun.file(path.join(env.root, "reports", "run-metadata.json")).json()) as {
          session_id: string
        }
        expect(metadata.session_id).toBe(parent.id)
      },
    })
  })
})
