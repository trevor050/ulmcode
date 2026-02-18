import z from "zod"
import { Tool } from "./tool"
import { SwarmTeamManager } from "@/features/swarm"

const parameters = z.object({
  team_id: z.string(),
})

export const TeamStopTool = Tool.define("team_stop", {
  description: "Stop a swarm team.",
  parameters,
  async execute(params) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const team = SwarmTeamManager.setStatus(params.team_id, "stopped")
    if (!team) throw new Error(`Team not found: ${params.team_id}`)
    return {
      title: `Stopped ${team.id}`,
      metadata: { team },
      output: `team_id: ${team.id}\nstatus: ${team.status}`,
    }
  },
})
