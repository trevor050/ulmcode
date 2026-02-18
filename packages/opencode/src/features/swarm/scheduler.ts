import { and, eq } from "@/storage/db"
import { Database } from "@/storage/db"
import { SwarmTaskTable } from "./swarm.sql"
import { SwarmAggressionPolicy } from "./aggression"

export namespace SwarmScheduler {
  export type RetryPolicy = "none" | "light" | "aggressive"

  export function maxRetries(policy: RetryPolicy) {
    if (policy === "none") return 0
    if (policy === "light") return 1
    return 3
  }

  export function backoffMs(policy: RetryPolicy, attempt: number) {
    if (policy === "none") return 0
    const base = policy === "light" ? 2_500 : 1_500
    return base * Math.max(attempt, 1)
  }

  export function limitsForAggression(input: {
    aggression: SwarmAggressionPolicy.Level
    maxParallelDepthCap?: number
  }) {
    return SwarmAggressionPolicy.derive({
      aggression: input.aggression,
      maxParallelDepthCap: input.maxParallelDepthCap,
    })
  }

  export function lane(input: { providerID?: string; modelID?: string; teamID?: string }) {
    if (input.providerID && input.modelID) return `model:${input.providerID}/${input.modelID}`
    if (input.providerID) return `provider:${input.providerID}`
    if (input.teamID) return `team:${input.teamID}`
    return "default"
  }

  export function counts() {
    const tasks = Database.use((db) =>
      db
        .select({
          id: SwarmTaskTable.id,
          team_id: SwarmTaskTable.team_id,
          provider_id: SwarmTaskTable.provider_id,
          model_id: SwarmTaskTable.model_id,
          scheduler_lane: SwarmTaskTable.scheduler_lane,
          status: SwarmTaskTable.status,
        })
        .from(SwarmTaskTable)
        .where(eq(SwarmTaskTable.status, "running"))
        .all(),
    )
    return {
      total: tasks.length,
      byLane: tasks.reduce<Record<string, number>>((acc, item) => {
        const key = item.scheduler_lane ?? "default"
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
      byProvider: tasks.reduce<Record<string, number>>((acc, item) => {
        if (!item.provider_id) return acc
        acc[item.provider_id] = (acc[item.provider_id] ?? 0) + 1
        return acc
      }, {}),
      byModel: tasks.reduce<Record<string, number>>((acc, item) => {
        if (!item.provider_id || !item.model_id) return acc
        const key = `${item.provider_id}/${item.model_id}`
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
    }
  }

  export function canRun(input: {
    lane: string
    providerID?: string
    modelID?: string
    defaultConcurrency: number
    providerConcurrency: Record<string, number>
    modelConcurrency: Record<string, number>
  }) {
    const active = counts()
    if (active.total >= input.defaultConcurrency) return false
    if (active.byLane[input.lane] && active.byLane[input.lane] >= input.defaultConcurrency) return false
    if (input.providerID) {
      const limit = input.providerConcurrency[input.providerID]
      if (limit && (active.byProvider[input.providerID] ?? 0) >= limit) return false
    }
    if (input.providerID && input.modelID) {
      const key = `${input.providerID}/${input.modelID}`
      const limit = input.modelConcurrency[key]
      if (limit && (active.byModel[key] ?? 0) >= limit) return false
    }
    return true
  }

  export function markRetry(input: { taskID: string; retryCount: number; status: "queued" | "failed" }) {
    Database.use((db) =>
      db
        .update(SwarmTaskTable)
        .set({
          retry_count: input.retryCount,
          status: input.status,
          time_updated: Date.now(),
        })
        .where(eq(SwarmTaskTable.id, input.taskID))
        .run(),
    )
  }

  export function runningTask(taskID: string) {
    return Database.use((db) =>
      db
        .select()
        .from(SwarmTaskTable)
        .where(and(eq(SwarmTaskTable.id, taskID), eq(SwarmTaskTable.status, "running")))
        .get(),
    )
  }
}
