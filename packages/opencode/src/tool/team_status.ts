import z from "zod"
import { Tool } from "./tool"
import { SwarmInbox, SwarmScheduler, SwarmTeamManager } from "@/features/swarm"

const parameters = z.object({
  team_id: z.string(),
})

export const TeamStatusTool = Tool.define("team_status", {
  description: "Inspect current team status, members, claims, and recent messages.",
  parameters,
  async execute(params) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const team = SwarmTeamManager.get(params.team_id)
    if (!team) throw new Error(`Team not found: ${params.team_id}`)

    const members = SwarmTeamManager.members(params.team_id)
    const claims = SwarmTeamManager.claims({ teamID: params.team_id, activeOnly: true })
    const messages = SwarmInbox.list({ teamID: params.team_id, limit: 20 })
    const scheduler = SwarmScheduler.counts()

    return {
      title: `Team status ${params.team_id}`,
      metadata: {
        team,
        members,
        activeClaims: claims,
        recentMessages: messages,
        scheduler,
      },
      output: [
        `team_id: ${team.id}`,
        `status: ${team.status}`,
        `topology: ${team.topology}`,
        `members: ${members.length}`,
        `active_claims: ${claims.length}`,
        `recent_messages: ${messages.length}`,
      ].join("\n"),
    }
  },
})
