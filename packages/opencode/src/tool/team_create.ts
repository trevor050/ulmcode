import z from "zod"
import { Tool } from "./tool"
import { SwarmTeamManager } from "@/features/swarm"

const parameters = z.object({
  root_session_id: z.string().optional(),
  title: z.string().min(1).default("Pentest Mesh Team"),
  topology: z.enum(["mesh", "brokered"]).optional(),
  autonomy_mode: z.enum(["high", "risk_gated", "operator_driven"]).optional(),
  tmux_enabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const TeamCreateTool = Tool.define("team_create", {
  description: "Create a swarm team for mesh subagent orchestration.",
  parameters,
  async execute(params, ctx) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const rootSessionID = params.root_session_id ?? (await SwarmTeamManager.resolveRootSessionID(ctx.sessionID))
    const team = await SwarmTeamManager.create({
      rootSessionID,
      title: params.title,
      topology: params.topology,
      autonomyMode: params.autonomy_mode,
      tmuxEnabled: params.tmux_enabled,
      metadata: params.metadata,
    })

    return {
      title: `Created team ${team.id}`,
      metadata: { team },
      output: [`team_id: ${team.id}`, `root_session_id: ${team.root_session_id}`, `status: ${team.status}`].join("\n"),
    }
  },
})
