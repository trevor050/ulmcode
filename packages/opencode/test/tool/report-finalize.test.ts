import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { CyberEnvironment } from "../../src/session/environment"
import { ReportFinalizeTool } from "../../src/tool/report_finalize"
import { tmpdir } from "../fixture/fixture"

const baseCtx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "pentest",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.report_finalize", () => {
  test("writes full report bundle artifacts", async () => {
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
            "<!-- finding_json:{\"id\":\"FND-1\",\"title\":\"Weak TLS\",\"severity\":\"high\",\"confidence\":0.8,\"asset\":\"web01\",\"evidence\":\"legacy tls\",\"impact\":\"downgrade risk\",\"recommendation\":\"disable old ciphers\",\"safe_reproduction_steps\":[\"run ssl scan\"],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )
        await Bun.write(path.join(env.root, "agents", "session_recon", "results.md"), "# Recon\nDiscovered hosts")
        await Bun.write(path.join(env.root, "reports", "report-plan.md"), "# Plan\n\n- finalize\n")
        await Bun.write(path.join(env.root, "reports", "report-outline.md"), "# Outline\n\n1. Summary\n")
        await Bun.write(path.join(env.root, "reports", "report-draft.md"), "# Draft\n\nDraft body.\n")
        await Bun.write(path.join(env.root, "reports", "report-render-plan.md"), "# Render Plan\n\n- HTML/CSS print\n")
        await Bun.write(path.join(env.root, "reports", "report.html"), "<html><body><h1>Client Pentest Report</h1></body></html>\n")
        await Bun.write(path.join(env.root, "reports", "report.md"), "# Client Pentest Report\n\n## Executive Summary\n- Session: authored\n")
        await Bun.write(path.join(env.root, "reports", "results.md"), "# Results\n\nAuthored results.\n")
        await Bun.write(path.join(env.root, "reports", "remediation-plan.md"), "# Remediation Plan\n\nAuthored remediation.\n")

        const tool = await ReportFinalizeTool.init()
        const result = await tool.execute(
          {
            session_id: session.id,
            plan_mode: "full_client_report",
            allow_no_pdf: true,
          },
          { ...baseCtx, sessionID: session.id },
        )

        expect(result.metadata.reportPath).toBeDefined()
        expect(await Bun.file(path.join(env.root, "reports", "report.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "reports", "results.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "reports", "remediation-plan.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "reports", "sources.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "reports", "timeline.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "reports", "quality-checks.json")).exists()).toBe(true)
        expect(result.output).toContain("Quality status:")
      },
    })
  })

  test("rejects degraded no-pdf mode for report_writer", async () => {
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
            "<!-- finding_json:{\"id\":\"FND-1\",\"title\":\"Weak TLS\",\"severity\":\"high\",\"confidence\":0.8,\"asset\":\"web01\",\"evidence\":\"legacy tls\",\"impact\":\"downgrade risk\",\"recommendation\":\"disable old ciphers\",\"safe_reproduction_steps\":[\"run ssl scan\"],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )

        const tool = await ReportFinalizeTool.init()
        await expect(
          tool.execute(
            {
              session_id: session.id,
              plan_mode: "full_client_report",
              allow_no_pdf: true,
            },
            { ...baseCtx, sessionID: session.id, agent: "report_writer" },
          ),
        ).rejects.toThrow("report_writer cannot set allow_no_pdf=true")
      },
    })
  })

  test("fails when required authored artifacts are missing", async () => {
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
            "<!-- finding_json:{\"id\":\"FND-1\",\"title\":\"Weak TLS\",\"severity\":\"high\",\"confidence\":0.8,\"asset\":\"web01\",\"evidence\":\"legacy tls\",\"impact\":\"downgrade risk\",\"recommendation\":\"disable old ciphers\",\"safe_reproduction_steps\":[\"run ssl scan\"],\"non_destructive\":true} -->",
            "",
          ].join("\n"),
        )
        await Bun.write(path.join(env.root, "reports", "report.md"), "# Client Pentest Report\n")

        const tool = await ReportFinalizeTool.init()
        await expect(
          tool.execute(
            {
              session_id: session.id,
              plan_mode: "full_client_report",
              allow_no_pdf: false,
            },
            { ...baseCtx, sessionID: session.id },
          ),
        ).rejects.toThrow("Missing required authored report artifacts")
      },
    })
  })
})
