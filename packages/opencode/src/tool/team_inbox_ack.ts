import z from "zod"
import { Tool } from "./tool"
import { SwarmInbox, SwarmTeamManager } from "@/features/swarm"

const parameters = z.object({
  team_id: z.string(),
  message_id: z.string(),
  from_session_id: z.string().optional(),
  note: z.string().optional(),
})

export const TeamInboxAckTool = Tool.define("team_inbox_ack", {
  description: "Acknowledge a team message to close the loop with sender(s).",
  parameters,
  async execute(params, ctx) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const team = SwarmTeamManager.get(params.team_id)
    if (!team) throw new Error(`Team not found: ${params.team_id}`)

    const message = SwarmInbox.get(params.message_id)
    if (!message || message.team_id !== params.team_id) {
      throw new Error(`Message not found in team ${params.team_id}: ${params.message_id}`)
    }

    const fromSessionID = params.from_session_id ?? ctx.sessionID
    const ackID = await SwarmInbox.send({
      teamID: params.team_id,
      type: SwarmInbox.MessageType.Ack,
      fromSessionID,
      toSessionID: message.from_session_id ?? undefined,
      payload: {
        acknowledged_message_id: params.message_id,
        note: params.note ?? "",
      },
      correlationID: params.message_id,
      dualWriteSessionID: ctx.sessionID,
    })

    return {
      title: `Acknowledged message ${params.message_id}`,
      metadata: {
        team,
        message_id: params.message_id,
        ack_message_id: ackID,
        from_session_id: fromSessionID,
        to_session_id: message.from_session_id,
      },
      output: `ack_message_id: ${ackID}`,
    }
  },
})
