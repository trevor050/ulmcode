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
  timeout_ms: z.number().int().positive().max(300000).default(30000),
  poll_ms: z.number().int().positive().max(10000).default(1000),
  limit: z.number().int().positive().max(200).default(10),
})

export const TeamWaitTool = Tool.define("team_wait", {
  description: "Wait for team inbox activity that matches filters.",
  parameters,
  async execute(params, ctx) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const team = SwarmTeamManager.get(params.team_id)
    if (!team) throw new Error(`Team not found: ${params.team_id}`)

    const scope = params.scope ?? "mine"
    const toSessionID = params.to_session_id ?? (scope === "mine" ? ctx.sessionID : undefined)
    const since = params.since_message_id ? SwarmInbox.get(params.since_message_id) : undefined

    const startedAt = Date.now()
    const timeoutMs = params.timeout_ms ?? 30000
    const pollMs = params.poll_ms ?? 1000
    const limit = params.limit ?? 10
    const deadline = startedAt + timeoutMs

    while (Date.now() <= deadline) {
      if (ctx.abort.aborted) throw new Error("team_wait aborted")
      const messages = SwarmInbox.list({
        teamID: params.team_id,
        toSessionID,
        types: params.types,
        sinceTimeCreated: since?.time_created,
        includeBroadcast: params.include_broadcast ?? true,
        limit,
      })
      if (messages.length > 0) {
        return {
          title: `team_wait received ${messages.length} message(s)`,
          metadata: {
            team,
            elapsed_ms: Date.now() - startedAt,
            count: messages.length,
            messages,
          },
          output: [
            `status: received`,
            `elapsed_ms: ${Date.now() - startedAt}`,
            `count: ${messages.length}`,
            `first_message_id: ${messages[0]?.id ?? "n/a"}`,
          ].join("\n"),
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }

    return {
      title: "team_wait timeout",
      metadata: {
        team,
        elapsed_ms: Date.now() - startedAt,
        count: 0,
        timed_out: true,
      },
      output: [
        `status: timeout`,
        `elapsed_ms: ${Date.now() - startedAt}`,
      ].join("\n"),
    }
  },
})
