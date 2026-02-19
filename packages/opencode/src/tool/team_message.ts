import z from "zod"
import { Tool } from "./tool"
import { SwarmInbox, SwarmTeamManager } from "@/features/swarm"

const parameters = z.object({
  team_id: z.string(),
  type: z.enum([
    SwarmInbox.MessageType.TaskOffer,
    SwarmInbox.MessageType.ClaimRequest,
    SwarmInbox.MessageType.ClaimGranted,
    SwarmInbox.MessageType.Blocked,
    SwarmInbox.MessageType.Handoff,
    SwarmInbox.MessageType.Completion,
    SwarmInbox.MessageType.Failure,
    SwarmInbox.MessageType.Ack,
    SwarmInbox.MessageType.Announcement,
  ]),
  to_session_id: z.string().optional(),
  from_session_id: z.string().optional(),
  payload: z.record(z.string(), z.any()).default({}),
  correlation_id: z.string().optional(),
  idempotency_key: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  ttl_seconds: z.number().int().positive().optional(),
  attempt: z.number().int().positive().optional(),
})

export const TeamMessageTool = Tool.define("team_message", {
  description: "Send a typed inter-agent message to a team inbox.",
  parameters,
  async execute(params, ctx) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const team = SwarmTeamManager.get(params.team_id)
    if (!team) throw new Error(`Team not found: ${params.team_id}`)

    const messageID = await SwarmInbox.send({
      teamID: params.team_id,
      type: params.type,
      fromSessionID: params.from_session_id ?? ctx.sessionID,
      toSessionID: params.to_session_id,
      payload: params.payload ?? {},
      correlationID: params.correlation_id,
      idempotencyKey: params.idempotency_key,
      priority: params.priority ?? "normal",
      ttlSeconds: params.ttl_seconds,
      attempt: params.attempt,
      dualWriteSessionID: ctx.sessionID,
    })

    return {
      title: `Sent team message ${messageID}`,
      metadata: {
        team,
        message: {
          id: messageID,
          type: params.type,
          to_session_id: params.to_session_id,
          from_session_id: params.from_session_id ?? ctx.sessionID,
        },
      },
      output: `message_id: ${messageID}`,
    }
  },
})
