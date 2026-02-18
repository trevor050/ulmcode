import z from "zod"
import { Tool } from "./tool"
import { SwarmTeamManager } from "@/features/swarm"

const parameters = z.object({
  team_id: z.string(),
})

export const TeamMembersTool = Tool.define("team_members", {
  description: "List members in a swarm team.",
  parameters,
  async execute(params) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const team = SwarmTeamManager.get(params.team_id)
    if (!team) throw new Error(`Team not found: ${params.team_id}`)

    const members = SwarmTeamManager.members(params.team_id)
    return {
      title: `Team members ${params.team_id}`,
      metadata: { team, count: members.length, members },
      output:
        members.length === 0
          ? "No members registered for this team yet."
          : members
              .map((member) => `session=${member.session_id} agent=${member.agent_name} role=${member.role} state=${member.state}`)
              .join("\n"),
    }
  },
})
