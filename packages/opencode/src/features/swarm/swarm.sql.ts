import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"
import { SessionTable } from "@/session/session.sql"

export const SwarmTeamTable = sqliteTable(
  "swarm_team",
  {
    id: text().primaryKey(),
    root_session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    status: text().notNull(),
    topology: text().notNull(),
    autonomy_mode: text().notNull(),
    tmux_enabled: integer().notNull().$default(() => 1),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [index("swarm_team_root_session_idx").on(table.root_session_id)],
)

export const SwarmMemberTable = sqliteTable(
  "swarm_member",
  {
    team_id: text()
      .notNull()
      .references(() => SwarmTeamTable.id, { onDelete: "cascade" }),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    agent_name: text().notNull(),
    role: text().notNull(),
    lane: text(),
    state: text().notNull(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.team_id, table.session_id] }),
    index("swarm_member_team_idx").on(table.team_id),
    index("swarm_member_session_idx").on(table.session_id),
  ],
)

export const SwarmTaskTable = sqliteTable(
  "swarm_task",
  {
    id: text().primaryKey(),
    team_id: text().references(() => SwarmTeamTable.id, { onDelete: "set null" }),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    parent_session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    caller_id: text(),
    caller_chain: text({ mode: "json" }).$type<
      Array<{
        callerId: string
        sessionId: string
        agent: string
        timestamp: string
      }>
    >(),
    delegation_depth: integer().notNull().$default(() => 0),
    description: text().notNull(),
    prompt: text().notNull(),
    subagent_type: text().notNull(),
    provider_id: text(),
    model_id: text(),
    teammate_targets: text({ mode: "json" }).$type<string[]>(),
    coordination_scope: text({ mode: "json" }).$type<string[]>(),
    expected_output_schema: text().notNull(),
    isolation_mode: text().notNull().$default(() => "shared"),
    retry_policy: text().notNull().$default(() => "none"),
    retry_count: integer().notNull().$default(() => 0),
    scheduler_lane: text(),
    claim_ids: text({ mode: "json" }).$type<string[]>(),
    status: text().notNull(),
    stale_timeout_ms: integer().notNull(),
    output: text(),
    error: text(),
    time_started: integer(),
    time_ended: integer(),
    ...Timestamps,
  },
  (table) => [
    index("swarm_task_team_idx").on(table.team_id),
    index("swarm_task_parent_session_idx").on(table.parent_session_id),
    index("swarm_task_session_idx").on(table.session_id),
    index("swarm_task_status_idx").on(table.status),
  ],
)

export const SwarmMessageTable = sqliteTable(
  "swarm_message",
  {
    id: text().primaryKey(),
    team_id: text()
      .notNull()
      .references(() => SwarmTeamTable.id, { onDelete: "cascade" }),
    type: text().notNull(),
    from_session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    to_session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("swarm_message_team_idx").on(table.team_id),
    index("swarm_message_to_session_idx").on(table.to_session_id),
  ],
)

export const SwarmClaimTable = sqliteTable(
  "swarm_claim",
  {
    id: text().primaryKey(),
    team_id: text()
      .notNull()
      .references(() => SwarmTeamTable.id, { onDelete: "cascade" }),
    task_id: text().references(() => SwarmTaskTable.id, { onDelete: "set null" }),
    scope: text().notNull(),
    owner_session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    status: text().notNull(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("swarm_claim_team_idx").on(table.team_id),
    index("swarm_claim_scope_idx").on(table.scope),
    index("swarm_claim_owner_idx").on(table.owner_session_id),
  ],
)

export const SwarmEventTable = sqliteTable(
  "swarm_event",
  {
    id: text().primaryKey(),
    team_id: text().references(() => SwarmTeamTable.id, { onDelete: "set null" }),
    task_id: text().references(() => SwarmTaskTable.id, { onDelete: "set null" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    event_type: text().notNull(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("swarm_event_team_idx").on(table.team_id),
    index("swarm_event_task_idx").on(table.task_id),
    index("swarm_event_session_idx").on(table.session_id),
  ],
)
