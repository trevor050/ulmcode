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
  SwarmInbox.MessageType.Announcement,
])

const parameters = z.object({
  team_id: z.string(),
  type: messageTypeEnum.default(SwarmInbox.MessageType.Announcement),
  payload: z.record(z.string(), z.any()).default({}),
  from_session_id: z.string().optional(),
  teammate_targets: z.array(z.string()).optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  ttl_seconds: z.number().int().positive().optional(),
})

export const TeamBroadcastTool = Tool.define("team_broadcast", {
  description: "Broadcast a message to team members (or selected targets).",
  parameters,
  async execute(params, ctx) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) throw new Error("swarm_v2 is disabled. Enable cyber.swarm_v2.enabled to use team tools.")

    const team = SwarmTeamManager.get(params.team_id)
    if (!team) throw new Error(`Team not found: ${params.team_id}`)

    const type = params.type ?? SwarmInbox.MessageType.Announcement
    const priority = params.priority ?? "normal"
    const fromSessionID = params.from_session_id ?? ctx.sessionID
    const members = SwarmTeamManager.members(params.team_id)
      .filter((member) => member.state !== "stopped")
      .map((member) => member.session_id)
    const uniqueTargets = Array.from(new Set(params.teammate_targets?.length ? params.teammate_targets : members))
      .filter((sessionID) => sessionID !== fromSessionID)

    const correlationID = `broadcast:${Date.now()}:${fromSessionID}`
    const messageIDs = await Promise.all(
      uniqueTargets.map((toSessionID) =>
        SwarmInbox.send({
          teamID: params.team_id,
          type,
          fromSessionID,
          toSessionID,
          payload: params.payload,
          correlationID,
          priority,
          ttlSeconds: params.ttl_seconds,
          dualWriteSessionID: ctx.sessionID,
        }),
      ),
    )

    return {
      title: `Broadcasted ${messageIDs.length} message(s)`,
      metadata: {
        team,
        type,
        from_session_id: fromSessionID,
        targets: uniqueTargets,
        message_ids: messageIDs,
      },
      output: [
        `sent: ${messageIDs.length}`,
        `targets: ${uniqueTargets.join(",") || "none"}`,
        `message_ids: ${messageIDs.join(",") || "none"}`,
      ].join("\n"),
    }
  },
})
