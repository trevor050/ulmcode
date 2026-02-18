import { ulid } from "ulid"
import { Database } from "@/storage/db"
import { SwarmEventTable } from "./swarm.sql"
import { SwarmTeamManager } from "./team-manager"

export namespace SwarmTelemetry {
  export async function event(input: {
    teamID?: string
    taskID?: string
    sessionID?: string
    type: string
    payload?: Record<string, unknown>
  }) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) return

    try {
      Database.use((db) =>
        db
          .insert(SwarmEventTable)
          .values({
            id: `se_${ulid().toLowerCase()}`,
            team_id: input.teamID ?? null,
            task_id: input.taskID ?? null,
            session_id: input.sessionID ?? null,
            event_type: input.type,
            payload: input.payload ?? {},
          })
          .run(),
      )
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("FOREIGN KEY constraint failed")) throw error
      Database.use((db) =>
        db
          .insert(SwarmEventTable)
          .values({
            id: `se_${ulid().toLowerCase()}`,
            team_id: null,
            task_id: null,
            session_id: null,
            event_type: input.type,
            payload: {
              ...(input.payload ?? {}),
              dropped_refs: {
                teamID: input.teamID ?? null,
                taskID: input.taskID ?? null,
                sessionID: input.sessionID ?? null,
              },
            },
          })
          .run(),
      )
    }
  }
}
