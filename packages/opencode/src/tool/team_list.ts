import z from "zod"
import { Tool } from "./tool"
import { SwarmTeamManager } from "@/features/swarm"

const parameters = z.object({
  root_session_id: z.string().optional(),
  status: z.array(z.enum(["active", "paused", "stopped"])).optional(),
})

export const TeamListTool = Tool.define("team_list", {
  description: "List swarm teams with optional root session and status filters.",
  parameters,
  async execute(params) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const teams = SwarmTeamManager.list({
      rootSessionID: params.root_session_id,
      status: params.status,
    })

    return {
      title: "Swarm teams",
      metadata: { count: teams.length, teams },
      output:
        teams.length === 0
          ? "No swarm teams found."
          : teams
              .map((team) => `id=${team.id} status=${team.status} topology=${team.topology} root_session=${team.root_session_id}`)
              .join("\n"),
    }
  },
})
