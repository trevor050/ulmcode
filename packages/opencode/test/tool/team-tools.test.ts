import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { TeamCreateTool } from "../../src/tool/team_create"
import { TeamListTool } from "../../src/tool/team_list"
import { TeamUpdateTool } from "../../src/tool/team_update"
import { TeamMembersTool } from "../../src/tool/team_members"
import { TeamMessageTool } from "../../src/tool/team_message"
import { TeamStatusTool } from "../../src/tool/team_status"
import { TeamPauseTool } from "../../src/tool/team_pause"
import { TeamResumeTool } from "../../src/tool/team_resume"
import { TeamStopTool } from "../../src/tool/team_stop"
import { SwarmTeamManager } from "../../src/features/swarm"

const baseCtx = {
  messageID: "",
  callID: "",
  agent: "plan",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.team_*", () => {
  test("creates, updates, and controls swarm teams", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        cyber: {
          swarm_v2: {
            enabled: true,
            dual_write_legacy_files: false,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "Swarm root" })
        const worker = await Session.create({ title: "Worker", parentID: root.id })

        const ctx = {
          ...baseCtx,
          sessionID: root.id,
        }

        const createTool = await TeamCreateTool.init()
        const createResult = await createTool.execute({ title: "Test mesh" }, ctx as any)
        const teamID = String((createResult.metadata as any).team.id)
        expect(teamID).toContain("team_")

        const listTool = await TeamListTool.init()
        const listResult = await listTool.execute({}, ctx as any)
        expect(listResult.output).toContain(teamID)

        SwarmTeamManager.upsertMember({
          teamID,
          sessionID: worker.id,
          agentName: "explore",
          role: "worker",
          state: "ready",
        })

        const membersTool = await TeamMembersTool.init()
        const membersResult = await membersTool.execute({ team_id: teamID }, ctx as any)
        expect(membersResult.output).toContain(worker.id)

        const messageTool = await TeamMessageTool.init()
        const messageResult = await messageTool.execute(
          {
            team_id: teamID,
            type: "handoff",
            to_session_id: worker.id,
            payload: { note: "hi" },
          },
          ctx as any,
        )
        expect(messageResult.output).toContain("message_id:")

        const statusTool = await TeamStatusTool.init()
        const statusResult = await statusTool.execute({ team_id: teamID }, ctx as any)
        expect(statusResult.output).toContain("members: 1")

        const updateTool = await TeamUpdateTool.init()
        const updateResult = await updateTool.execute({ team_id: teamID, topology: "brokered" }, ctx as any)
        expect(updateResult.output).toContain("topology: brokered")

        const pauseTool = await TeamPauseTool.init()
        const pauseResult = await pauseTool.execute({ team_id: teamID }, ctx as any)
        expect(pauseResult.output).toContain("status: paused")

        const resumeTool = await TeamResumeTool.init()
        const resumeResult = await resumeTool.execute({ team_id: teamID }, ctx as any)
        expect(resumeResult.output).toContain("status: active")

        const stopTool = await TeamStopTool.init()
        const stopResult = await stopTool.execute({ team_id: teamID }, ctx as any)
        expect(stopResult.output).toContain("status: stopped")
      },
    })
  })
})
