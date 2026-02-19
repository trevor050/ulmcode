import { ulid } from "ulid"
import path from "path"
import fs from "fs/promises"
import { desc, eq } from "@/storage/db"
import { Database } from "@/storage/db"
import { SwarmMessageTable } from "./swarm.sql"
import { CyberEnvironment } from "@/session/environment"
import { Session } from "@/session"
import { SwarmTeamManager } from "./team-manager"

export namespace SwarmInbox {
  export const MessageType = {
    TaskOffer: "task_offer",
    ClaimRequest: "claim_request",
    ClaimGranted: "claim_granted",
    Blocked: "blocked",
    Handoff: "handoff",
    Completion: "completion",
    Failure: "failure",
    Ack: "ack",
    Announcement: "announcement",
  } as const

  export type MessageType = (typeof MessageType)[keyof typeof MessageType]

  export async function send(input: {
    teamID: string
    type: MessageType
    fromSessionID?: string
    toSessionID?: string
    payload: Record<string, unknown>
    correlationID?: string
    idempotencyKey?: string
    priority?: "low" | "normal" | "high" | "critical"
    ttlSeconds?: number
    attempt?: number
    dualWriteSessionID?: string
  }) {
    const id = `sm_${ulid().toLowerCase()}`
    const now = Date.now()
    const expiresAt = input.ttlSeconds && input.ttlSeconds > 0 ? now + input.ttlSeconds * 1000 : undefined
    const payload = {
      ...input.payload,
      _meta: {
        correlation_id: input.correlationID ?? id,
        idempotency_key: input.idempotencyKey ?? null,
        priority: input.priority ?? "normal",
        ttl_seconds: input.ttlSeconds ?? null,
        expires_at: expiresAt ?? null,
        attempt: input.attempt ?? 1,
      },
    }
    Database.use((db) =>
      db.insert(SwarmMessageTable).values({
        id,
        team_id: input.teamID,
        type: input.type,
        from_session_id: input.fromSessionID ?? null,
        to_session_id: input.toSessionID ?? null,
        payload,
      }).run(),
    )

    const flags = await SwarmTeamManager.flags()
    if (!flags.dualWriteLegacyFiles || !input.dualWriteSessionID) return id

    const session = await Session.get(input.dualWriteSessionID).catch(() => undefined)
    if (session?.environment?.type !== "cyber") return id

    await CyberEnvironment.appendCoordinationInbox({
      session,
      ownerSessionID: input.toSessionID ?? input.dualWriteSessionID,
      payload: {
        id,
        type: input.type,
        from_session_id: input.fromSessionID ?? null,
        to_session_id: input.toSessionID ?? null,
        ...payload,
      },
    })
    return id
  }

  export function get(messageID: string) {
    return Database.use((db) => db.select().from(SwarmMessageTable).where(eq(SwarmMessageTable.id, messageID)).get())
  }

  export function list(input: {
    teamID: string
    toSessionID?: string
    limit?: number
    types?: MessageType[]
    sinceTimeCreated?: number
    includeBroadcast?: boolean
  }) {
    return Database.use((db) => {
      const rows = db
        .select()
        .from(SwarmMessageTable)
        .where(eq(SwarmMessageTable.team_id, input.teamID))
        .orderBy(desc(SwarmMessageTable.time_created))
        .limit(Math.max(input.limit ?? 200, 200))
        .all()
      const includeBroadcast = input.includeBroadcast ?? true
      const filtered = rows.filter((row) => {
        if (input.toSessionID) {
          const direct = row.to_session_id === input.toSessionID
          const broadcast = includeBroadcast && row.to_session_id === null
          if (!direct && !broadcast) return false
        }
        if (input.types?.length && !input.types.includes(row.type as MessageType)) return false
        if (input.sinceTimeCreated && row.time_created <= input.sinceTimeCreated) return false
        const meta = (row.payload as any)?._meta
        if (meta?.expires_at && Number(meta.expires_at) > 0 && Number(meta.expires_at) < Date.now()) return false
        return true
      })
      return filtered.slice(0, input.limit ?? 200)
    })
  }

  export async function exportJsonl(input: { teamID: string; file: string }) {
    const rows = list({ teamID: input.teamID, limit: 5000 })
    await fs.mkdir(path.dirname(input.file), { recursive: true })
    const body = rows
      .toReversed()
      .map((row) =>
        JSON.stringify({
          id: row.id,
          type: row.type,
          from_session_id: row.from_session_id,
          to_session_id: row.to_session_id,
          payload: row.payload,
          timestamp: new Date(row.time_created).toISOString(),
        }),
      )
      .join("\n")
    await fs.writeFile(input.file, body + (body ? "\n" : ""), "utf8")
    return rows.length
  }
}
