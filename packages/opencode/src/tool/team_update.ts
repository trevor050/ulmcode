import z from "zod"
import { Tool } from "./tool"
import { SwarmTeamManager } from "@/features/swarm"

const parameters = z.object({
  team_id: z.string(),
  title: z.string().min(1).optional(),
  status: z.enum(["active", "paused", "stopped"]).optional(),
  topology: z.enum(["mesh", "brokered"]).optional(),
  autonomy_mode: z.enum(["high", "risk_gated", "operator_driven"]).optional(),
  tmux_enabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const TeamUpdateTool = Tool.define("team_update", {
  description: "Update a swarm team configuration.",
  parameters,
  async execute(params) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const team = SwarmTeamManager.update(params.team_id, {
      title: params.title,
      status: params.status,
      topology: params.topology,
      autonomyMode: params.autonomy_mode,
      tmuxEnabled: params.tmux_enabled,
      metadata: params.metadata,
    })
    if (!team) throw new Error(`Team not found: ${params.team_id}`)

    return {
      title: `Updated team ${team.id}`,
      metadata: { team },
      output: [`team_id: ${team.id}`, `status: ${team.status}`, `topology: ${team.topology}`].join("\n"),
    }
  },
})
