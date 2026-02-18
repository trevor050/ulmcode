import { ulid } from "ulid"
import { and, desc, eq, inArray } from "@/storage/db"
import { Database } from "@/storage/db"
import { SwarmClaimTable, SwarmMemberTable, SwarmTaskTable, SwarmTeamTable } from "./swarm.sql"
import { Config } from "@/config/config"
import { Session } from "@/session"
import { Flag } from "@/flag/flag"

export namespace SwarmTeamManager {
  export type TeamStatus = "active" | "paused" | "stopped"
  export type MemberState = "ready" | "running" | "paused" | "stopped"
  export type ClaimStatus = "claimed" | "blocked" | "released" | "completed" | "failed" | "cancelled"

  export type Flags = {
    enabled: boolean
    dualWriteLegacyFiles: boolean
    sqliteReadCanonical: boolean
    tmuxDefaultEnabled: boolean
    highAutonomy: boolean
    defaultTopology: "mesh" | "brokered"
  }

  export async function flags(): Promise<Flags> {
    const cfg = await Config.get()
    return {
      enabled: cfg.cyber?.swarm_v2?.enabled ?? Flag.OPENCODE_EXPERIMENTAL_SWARM_V2 ?? false,
      dualWriteLegacyFiles:
        cfg.cyber?.swarm_v2?.dual_write_legacy_files ??
        Flag.OPENCODE_EXPERIMENTAL_SWARM_V2_DUAL_WRITE_LEGACY_FILES ??
        true,
      sqliteReadCanonical:
        cfg.cyber?.swarm_v2?.sqlite_read_canonical ??
        Flag.OPENCODE_EXPERIMENTAL_SWARM_V2_SQLITE_READ_CANONICAL ??
        false,
      tmuxDefaultEnabled:
        cfg.cyber?.swarm_v2?.tmux_default_enabled ??
        Flag.OPENCODE_EXPERIMENTAL_SWARM_V2_TMUX_DEFAULT_ENABLED ??
        true,
      highAutonomy: cfg.cyber?.swarm_v2?.high_autonomy ?? true,
      defaultTopology: cfg.cyber?.swarm_v2?.default_topology ?? "mesh",
    }
  }

  export async function resolveRootSessionID(sessionID: string) {
    let cursor = await Session.get(sessionID)
    const visited = new Set<string>()
    while (cursor.parentID && !visited.has(cursor.id)) {
      visited.add(cursor.id)
      const parent = await Session.get(cursor.parentID).catch(() => undefined)
      if (!parent) break
      cursor = parent
    }
    return cursor.id
  }

  export async function create(input: {
    rootSessionID: string
    title: string
    topology?: "mesh" | "brokered"
    autonomyMode?: "high" | "risk_gated" | "operator_driven"
    tmuxEnabled?: boolean
    metadata?: Record<string, unknown>
  }) {
    const id = `team_${ulid().toLowerCase()}`
    const cfg = await flags()
    const now = Date.now()
    const team = {
      id,
      root_session_id: input.rootSessionID,
      title: input.title,
      status: "active" as TeamStatus,
      topology: input.topology ?? cfg.defaultTopology,
      autonomy_mode: input.autonomyMode ?? (cfg.highAutonomy ? "high" : "risk_gated"),
      tmux_enabled: input.tmuxEnabled === undefined ? (cfg.tmuxDefaultEnabled ? 1 : 0) : input.tmuxEnabled ? 1 : 0,
      metadata: input.metadata ?? {},
      time_created: now,
      time_updated: now,
    }
    Database.use((db) => db.insert(SwarmTeamTable).values(team).run())
    return team
  }

  export function get(teamID: string) {
    return Database.use((db) => db.select().from(SwarmTeamTable).where(eq(SwarmTeamTable.id, teamID)).get())
  }

  export function list(input?: { rootSessionID?: string; status?: TeamStatus[] }) {
    return Database.use((db) => {
      if (input?.rootSessionID && input?.status?.length) {
        return db
          .select()
          .from(SwarmTeamTable)
          .where(and(eq(SwarmTeamTable.root_session_id, input.rootSessionID), inArray(SwarmTeamTable.status, input.status)))
          .orderBy(desc(SwarmTeamTable.time_updated))
          .all()
      }
      if (input?.rootSessionID) {
        return db
          .select()
          .from(SwarmTeamTable)
          .where(eq(SwarmTeamTable.root_session_id, input.rootSessionID))
          .orderBy(desc(SwarmTeamTable.time_updated))
          .all()
      }
      if (input?.status?.length) {
        return db
          .select()
          .from(SwarmTeamTable)
          .where(inArray(SwarmTeamTable.status, input.status))
          .orderBy(desc(SwarmTeamTable.time_updated))
          .all()
      }
      return db.select().from(SwarmTeamTable).orderBy(desc(SwarmTeamTable.time_updated)).all()
    })
  }

  export async function ensureDefaultTeam(input: {
    sessionID: string
    title?: string
  }) {
    const rootSessionID = await resolveRootSessionID(input.sessionID)
    const existing = list({ rootSessionID, status: ["active", "paused"] })[0]
    if (existing) return existing
    return create({
      rootSessionID,
      title: input.title ?? "Pentest Mesh Team",
    })
  }

  export function update(
    teamID: string,
    input: {
      title?: string
      status?: TeamStatus
      topology?: "mesh" | "brokered"
      autonomyMode?: "high" | "risk_gated" | "operator_driven"
      tmuxEnabled?: boolean
      metadata?: Record<string, unknown>
    },
  ) {
    const now = Date.now()
    Database.use((db) =>
      db
        .update(SwarmTeamTable)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.topology !== undefined ? { topology: input.topology } : {}),
          ...(input.autonomyMode !== undefined ? { autonomy_mode: input.autonomyMode } : {}),
          ...(input.tmuxEnabled !== undefined ? { tmux_enabled: input.tmuxEnabled ? 1 : 0 } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
          time_updated: now,
        })
        .where(eq(SwarmTeamTable.id, teamID))
        .run(),
    )
    return get(teamID)
  }

  export function setStatus(teamID: string, status: TeamStatus) {
    return update(teamID, { status })
  }

  export function members(teamID: string) {
    return Database.use((db) => db.select().from(SwarmMemberTable).where(eq(SwarmMemberTable.team_id, teamID)).all())
  }

  export function upsertMember(input: {
    teamID: string
    sessionID: string
    agentName: string
    role: string
    lane?: string
    state?: MemberState
    metadata?: Record<string, unknown>
  }) {
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(SwarmMemberTable)
        .values({
          team_id: input.teamID,
          session_id: input.sessionID,
          agent_name: input.agentName,
          role: input.role,
          lane: input.lane,
          state: input.state ?? "ready",
          metadata: input.metadata ?? {},
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: [SwarmMemberTable.team_id, SwarmMemberTable.session_id],
          set: {
            agent_name: input.agentName,
            role: input.role,
            lane: input.lane,
            state: input.state ?? "ready",
            metadata: input.metadata ?? {},
            time_updated: now,
          },
        })
        .run(),
    )
    return members(input.teamID)
  }

  export function claimScopes(input: {
    teamID: string
    taskID?: string
    ownerSessionID: string
    scopes: string[]
    allowOverlap?: boolean
    metadata?: Record<string, unknown>
  }) {
    if (input.scopes.length === 0) return { blocked: [] as string[], claims: [] as string[] }
    const now = Date.now()
    const active = Database.use((db) =>
      db
        .select()
        .from(SwarmClaimTable)
        .where(and(eq(SwarmClaimTable.team_id, input.teamID), eq(SwarmClaimTable.status, "claimed")))
        .all(),
    )
    const blocked = input.scopes.filter((scope) =>
      active.some((item) => item.scope === scope && item.owner_session_id !== input.ownerSessionID),
    )
    if (blocked.length > 0 && !input.allowOverlap) {
      return { blocked, claims: [] as string[] }
    }
    const claimIDs: string[] = []
    for (const scope of input.scopes) {
      const id = `claim_${ulid().toLowerCase()}`
      claimIDs.push(id)
      Database.use((db) =>
        db
          .insert(SwarmClaimTable)
          .values({
            id,
            team_id: input.teamID,
            task_id: input.taskID,
            scope,
            owner_session_id: input.ownerSessionID,
            status: "claimed",
            metadata: input.metadata ?? {},
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
    }
    return { blocked, claims: claimIDs }
  }

  export function releaseClaims(input: {
    ownerSessionID: string
    scopes?: string[]
    status?: ClaimStatus
  }) {
    const status = input.status ?? "released"
    const now = Date.now()
    const claims = Database.use((db) =>
      db
        .select()
        .from(SwarmClaimTable)
        .where(and(eq(SwarmClaimTable.owner_session_id, input.ownerSessionID), eq(SwarmClaimTable.status, "claimed")))
        .all(),
    )
    const target = input.scopes?.length ? claims.filter((item) => input.scopes?.includes(item.scope)) : claims
    for (const claim of target) {
      Database.use((db) =>
        db
          .update(SwarmClaimTable)
          .set({
            status,
            time_updated: now,
          })
          .where(eq(SwarmClaimTable.id, claim.id))
          .run(),
      )
    }
    return target.map((item) => item.id)
  }

  export function claims(input: { teamID?: string; ownerSessionID?: string; activeOnly?: boolean }) {
    return Database.use((db) => {
      const activeOnly = input.activeOnly ?? false
      if (input.teamID && input.ownerSessionID && activeOnly) {
        return db
          .select()
          .from(SwarmClaimTable)
          .where(
            and(
              eq(SwarmClaimTable.team_id, input.teamID),
              eq(SwarmClaimTable.owner_session_id, input.ownerSessionID),
              eq(SwarmClaimTable.status, "claimed"),
            ),
          )
          .all()
      }
      if (input.teamID && input.ownerSessionID) {
        return db
          .select()
          .from(SwarmClaimTable)
          .where(and(eq(SwarmClaimTable.team_id, input.teamID), eq(SwarmClaimTable.owner_session_id, input.ownerSessionID)))
          .all()
      }
      if (input.teamID && activeOnly) {
        return db
          .select()
          .from(SwarmClaimTable)
          .where(and(eq(SwarmClaimTable.team_id, input.teamID), eq(SwarmClaimTable.status, "claimed")))
          .all()
      }
      if (input.ownerSessionID && activeOnly) {
        return db
          .select()
          .from(SwarmClaimTable)
          .where(and(eq(SwarmClaimTable.owner_session_id, input.ownerSessionID), eq(SwarmClaimTable.status, "claimed")))
          .all()
      }
      if (input.teamID) return db.select().from(SwarmClaimTable).where(eq(SwarmClaimTable.team_id, input.teamID)).all()
      if (input.ownerSessionID) {
        return db.select().from(SwarmClaimTable).where(eq(SwarmClaimTable.owner_session_id, input.ownerSessionID)).all()
      }
      if (activeOnly) return db.select().from(SwarmClaimTable).where(eq(SwarmClaimTable.status, "claimed")).all()
      return db.select().from(SwarmClaimTable).all()
    })
  }

  export function linkTaskClaims(taskID: string, claimIDs: string[]) {
    const now = Date.now()
    Database.use((db) =>
      db
        .update(SwarmTaskTable)
        .set({
          claim_ids: claimIDs,
          time_updated: now,
        })
        .where(eq(SwarmTaskTable.id, taskID))
        .run(),
    )
  }
}
