import z from "zod"
import { Tool } from "./tool"
import { SwarmInbox, SwarmTeamManager } from "@/features/swarm"

const messageTypeEnum = z.enum([
  SwarmInbox.MessageType.TaskOffer,
  SwarmInbox.MessageType.ClaimRequest,
  SwarmInbox.MessageType.ClaimGranted,
  SwarmInbox.MessageType.Blocked,
  SwarmInbox.MessageType.Handoff,
  SwarmInbox.MessageType.Completion,
  SwarmInbox.MessageType.Failure,
  SwarmInbox.MessageType.Ack,
  SwarmInbox.MessageType.Announcement,
])

const parameters = z.object({
  team_id: z.string(),
  scope: z.enum(["mine", "team"]).default("mine"),
  to_session_id: z.string().optional(),
  types: z.array(messageTypeEnum).optional(),
  since_message_id: z.string().optional(),
  include_broadcast: z.boolean().default(true),
  limit: z.number().int().positive().max(500).default(50),
})

export const TeamInboxReadTool = Tool.define("team_inbox_read", {
  description: "Read team inbox messages with optional per-session filtering.",
  parameters,
  async execute(params, ctx) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const team = SwarmTeamManager.get(params.team_id)
    if (!team) throw new Error(`Team not found: ${params.team_id}`)

    const scope = params.scope ?? "mine"
    const toSessionID = params.to_session_id ?? (scope === "mine" ? ctx.sessionID : undefined)
    const since = params.since_message_id ? SwarmInbox.get(params.since_message_id) : undefined

    const messages = SwarmInbox.list({
      teamID: params.team_id,
      toSessionID,
      types: params.types,
      sinceTimeCreated: since?.time_created,
      includeBroadcast: params.include_broadcast ?? true,
      limit: params.limit ?? 50,
    })

    const output = [
      `team_id: ${params.team_id}`,
      `scope: ${scope}`,
      `to_session_id: ${toSessionID ?? "all"}`,
      `count: ${messages.length}`,
      "",
      ...messages.map((message) => {
        const payload = JSON.stringify(message.payload)
        return [
          `- id: ${message.id}`,
          `  type: ${message.type}`,
          `  from: ${message.from_session_id ?? "n/a"}`,
          `  to: ${message.to_session_id ?? "broadcast"}`,
          `  created_at: ${new Date(message.time_created).toISOString()}`,
          `  payload: ${payload}`,
        ].join("\n")
      }),
    ].join("\n")

    return {
      title: `Read ${messages.length} team inbox message(s)`,
      metadata: {
        team,
        scope,
        count: messages.length,
        messages,
      },
      output,
    }
  },
})
