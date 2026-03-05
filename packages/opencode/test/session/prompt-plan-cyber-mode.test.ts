import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { CyberEnvironment } from "../../src/session/environment"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

describe("session.prompt cyber plan mode reminder", () => {
  test("requires a deep execution-ready pentest plan with explicit delegation boundaries and reporting closeout", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Cyber planning" })
        const environment = CyberEnvironment.create(session)
        await Session.update(session.id, (draft) => {
          draft.environment = environment
        })

        const refreshed = await Session.get(session.id)
        const reminder = SessionPrompt.buildPlanModeReminder({
          session: refreshed,
          plan: path.join(tmp.path, ".opencode", "plans", `${session.id}.md`),
          exists: false,
        })

        expect(reminder).toContain("absolute, execution-ready pentest plan")
        expect(reminder).toContain("Front-load depth before handoff")
        expect(reminder).toContain('explicit "where subagents WILL be used" section')
        expect(reminder).toContain('explicit "where subagents WILL NOT be used" section')
        expect(reminder).toContain("Do NOT use subagents for initial scope framing")
        expect(reminder).toContain("The final section of the plan must describe the reporting closeout")
        expect(reminder).toContain("Invoke the `report_writer` subagent")
        expect(reminder).toContain("Produce a high-quality `report.html`")
        expect(reminder).toContain("Compile the final print-ready PDF from the HTML/CSS report flow")
      },
    })
  })
})
