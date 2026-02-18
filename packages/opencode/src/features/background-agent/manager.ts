import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { ulid } from "ulid"
import { and, desc, eq } from "@/storage/db"
import { Database } from "@/storage/db"
import { SwarmTaskTable } from "@/features/swarm/swarm.sql"
import { SwarmScheduler } from "@/features/swarm/scheduler"
import { SwarmTelemetry } from "@/features/swarm/telemetry"
import { SwarmTeamManager } from "@/features/swarm/team-manager"
import { SwarmWatchdog } from "@/features/swarm/watchdog"

export namespace BackgroundAgentManager {
  const log = Log.create({ service: "background-agent.manager" })

  export type Status = "queued" | "running" | "completed" | "failed" | "cancelled" | "stale_timeout"

  export type TaskRecord = {
    id: string
    teamId?: string
    callerId?: string
    callerChain: Array<{
      callerId: string
      sessionId: string
      agent: string
      timestamp: string
    }>
    delegationDepth: number
    description: string
    prompt: string
    subagentType: string
    parentSessionID: string
    sessionID: string
    providerID?: string
    modelID?: string
    teammateTargets: string[]
    coordinationScope: string[]
    expectedOutputSchema: "brief" | "evidence_summary" | "report_section"
    isolationMode: "shared" | "isolated"
    retryPolicy: "none" | "light" | "aggressive"
    retryCount: number
    schedulerLane: string
    claimIds: string[]
    status: Status
    createdAt: number
    startedAt?: number
    endedAt?: number
    durationMs?: number
    staleTimeoutMs: number
    output?: string
    error?: string
  }

  type StartInput = {
    description: string
    prompt: string
    subagentType: string
    parentSessionID: string
    sessionID: string
    providerID?: string
    modelID?: string
    teammateTargets?: string[]
    coordinationScope?: string[]
    expectedOutputSchema?: "brief" | "evidence_summary" | "report_section"
    teamID?: string
    callerID?: string
    callerChain?: TaskRecord["callerChain"]
    delegationDepth?: number
    isolationMode?: "shared" | "isolated"
    retryPolicy?: "none" | "light" | "aggressive"
    claimIds?: string[]
    run: (input: { signal: AbortSignal; touch(): void }) => Promise<{ output: string }>
    cancel: () => void
  }

  type RunningTask = {
    abort: AbortController
    run: StartInput["run"]
    cancel: StartInput["cancel"]
  }

  const state = Instance.state(() => ({
    tasks: new Map<string, TaskRecord>(),
    queue: [] as string[],
    running: new Map<string, RunningTask>(),
    runners: new Map<string, Pick<RunningTask, "run" | "cancel">>(),
  }))

  function nowIso(ms?: number) {
    return new Date(ms ?? Date.now()).toISOString()
  }

  async function persistTask(task: TaskRecord) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled) return
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(SwarmTaskTable)
        .values({
          id: task.id,
          team_id: task.teamId ?? null,
          session_id: task.sessionID,
          parent_session_id: task.parentSessionID,
          caller_id: task.callerId ?? null,
          caller_chain: task.callerChain,
          delegation_depth: task.delegationDepth,
          description: task.description,
          prompt: task.prompt,
          subagent_type: task.subagentType,
          provider_id: task.providerID ?? null,
          model_id: task.modelID ?? null,
          teammate_targets: task.teammateTargets,
          coordination_scope: task.coordinationScope,
          expected_output_schema: task.expectedOutputSchema,
          isolation_mode: task.isolationMode,
          retry_policy: task.retryPolicy,
          retry_count: task.retryCount,
          scheduler_lane: task.schedulerLane,
          claim_ids: task.claimIds,
          status: task.status,
          stale_timeout_ms: task.staleTimeoutMs,
          output: task.output ?? null,
          error: task.error ?? null,
          time_started: task.startedAt ?? null,
          time_ended: task.endedAt ?? null,
          time_created: task.createdAt,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: SwarmTaskTable.id,
          set: {
            team_id: task.teamId ?? null,
            caller_id: task.callerId ?? null,
            caller_chain: task.callerChain,
            delegation_depth: task.delegationDepth,
            description: task.description,
            prompt: task.prompt,
            subagent_type: task.subagentType,
            provider_id: task.providerID ?? null,
            model_id: task.modelID ?? null,
            teammate_targets: task.teammateTargets,
            coordination_scope: task.coordinationScope,
            expected_output_schema: task.expectedOutputSchema,
            isolation_mode: task.isolationMode,
            retry_policy: task.retryPolicy,
            retry_count: task.retryCount,
            scheduler_lane: task.schedulerLane,
            claim_ids: task.claimIds,
            status: task.status,
            stale_timeout_ms: task.staleTimeoutMs,
            output: task.output ?? null,
            error: task.error ?? null,
            time_started: task.startedAt ?? null,
            time_ended: task.endedAt ?? null,
            time_updated: now,
          },
        })
        .run(),
    )
  }

  function fromDb(row: typeof SwarmTaskTable.$inferSelect): TaskRecord {
    return {
      id: row.id,
      teamId: row.team_id ?? undefined,
      callerId: row.caller_id ?? undefined,
      callerChain: row.caller_chain ?? [],
      delegationDepth: row.delegation_depth,
      description: row.description,
      prompt: row.prompt,
      subagentType: row.subagent_type,
      parentSessionID: row.parent_session_id,
      sessionID: row.session_id,
      providerID: row.provider_id ?? undefined,
      modelID: row.model_id ?? undefined,
      teammateTargets: row.teammate_targets ?? [],
      coordinationScope: row.coordination_scope ?? [],
      expectedOutputSchema: row.expected_output_schema as TaskRecord["expectedOutputSchema"],
      isolationMode: row.isolation_mode as TaskRecord["isolationMode"],
      retryPolicy: row.retry_policy as TaskRecord["retryPolicy"],
      retryCount: row.retry_count,
      schedulerLane: row.scheduler_lane ?? "default",
      claimIds: row.claim_ids ?? [],
      status: row.status as Status,
      createdAt: row.time_created,
      startedAt: row.time_started ?? undefined,
      endedAt: row.time_ended ?? undefined,
      durationMs: row.time_ended && row.time_started ? row.time_ended - row.time_started : undefined,
      staleTimeoutMs: row.stale_timeout_ms,
      output: row.output ?? undefined,
      error: row.error ?? undefined,
    }
  }

  async function readTasks(input?: { parentSessionID?: string; includeCompleted?: boolean }) {
    const flags = await SwarmTeamManager.flags()
    if (!flags.enabled || !flags.sqliteReadCanonical) {
      const includeCompleted = input?.includeCompleted ?? true
      const all = Array.from(state().tasks.values()).sort((a, b) => b.createdAt - a.createdAt)
      return all.filter((item) => {
        if (!includeCompleted && ["completed", "failed", "cancelled", "stale_timeout"].includes(item.status)) return false
        if (input?.parentSessionID && item.parentSessionID !== input.parentSessionID) return false
        return true
      })
    }

    const rows = Database.use((db) => {
      if (input?.parentSessionID) {
        return db
          .select()
          .from(SwarmTaskTable)
          .where(eq(SwarmTaskTable.parent_session_id, input.parentSessionID))
          .orderBy(desc(SwarmTaskTable.time_created))
          .all()
      }
      return db.select().from(SwarmTaskTable).orderBy(desc(SwarmTaskTable.time_created)).all()
    })
    const includeCompleted = input?.includeCompleted ?? true
    return rows.map(fromDb).filter((item) => {
      if (!includeCompleted && ["completed", "failed", "cancelled", "stale_timeout"].includes(item.status)) return false
      return true
    })
  }

  export async function start(input: StartInput) {
    const cfg = await Config.get()
    const flags = await SwarmTeamManager.flags()
    const team = input.teamID
      ? SwarmTeamManager.get(input.teamID)
      : flags.enabled
        ? await SwarmTeamManager.ensureDefaultTeam({ sessionID: input.parentSessionID })
        : undefined
    const schedulerLane = SwarmScheduler.lane({
      providerID: input.providerID,
      modelID: input.modelID,
      teamID: team?.id,
    })
    const task: TaskRecord = {
      id: `bg_${ulid().toLowerCase()}`,
      teamId: team?.id,
      callerId: input.callerID,
      callerChain: input.callerChain ?? [],
      delegationDepth: input.delegationDepth ?? 0,
      description: input.description,
      prompt: input.prompt,
      subagentType: input.subagentType,
      parentSessionID: input.parentSessionID,
      sessionID: input.sessionID,
      providerID: input.providerID,
      modelID: input.modelID,
      teammateTargets: input.teammateTargets ?? [],
      coordinationScope: input.coordinationScope ?? [],
      expectedOutputSchema: input.expectedOutputSchema ?? "brief",
      isolationMode: input.isolationMode ?? "shared",
      retryPolicy: input.retryPolicy ?? "none",
      retryCount: 0,
      schedulerLane,
      claimIds: input.claimIds ?? [],
      status: "queued",
      createdAt: Date.now(),
      staleTimeoutMs: Math.max(60_000, cfg.cyber?.background_task?.stale_timeout_ms ?? 180_000),
    }

    const s = state()
    s.tasks.set(task.id, task)
    s.runners.set(task.id, {
      run: input.run,
      cancel: input.cancel,
    })
    s.queue.push(task.id)

    await persistTask(task)
    await SwarmTelemetry.event({
      teamID: task.teamId,
      taskID: task.id,
      sessionID: task.sessionID,
      type: "task_queued",
      payload: {
        scheduler_lane: task.schedulerLane,
        subagent_type: task.subagentType,
        created_at: nowIso(task.createdAt),
      },
    })

    if (task.teamId) {
      SwarmTeamManager.upsertMember({
        teamID: task.teamId,
        sessionID: task.sessionID,
        agentName: task.subagentType,
        role: "worker",
        lane: task.schedulerLane,
        state: "ready",
      })
    }

    log.info("background task queued", {
      id: task.id,
      sessionID: task.sessionID,
      parentSessionID: task.parentSessionID,
      subagentType: task.subagentType,
      teamID: task.teamId,
      schedulerLane: task.schedulerLane,
    })

    void runQueue()
    return task
  }

  export async function list(input?: { parentSessionID?: string; includeCompleted?: boolean }) {
    return readTasks(input)
  }

  export async function get(id: string) {
    const flags = await SwarmTeamManager.flags()
    if (flags.enabled && flags.sqliteReadCanonical) {
      const row = Database.use((db) => db.select().from(SwarmTaskTable).where(eq(SwarmTaskTable.id, id)).get())
      return row ? fromDb(row) : undefined
    }
    return state().tasks.get(id)
  }

  export async function cancel(id: string) {
    const s = state()
    const task = s.tasks.get(id) ?? (await get(id))
    if (!task) return undefined

    if (task.status === "queued") {
      task.status = "cancelled"
      task.endedAt = Date.now()
      task.durationMs = (task.endedAt ?? task.createdAt) - (task.startedAt ?? task.createdAt)
      s.queue = s.queue.filter((item) => item !== id)
      s.runners.delete(id)
      s.tasks.set(id, task)
      await persistTask(task)
      await SwarmTelemetry.event({
        teamID: task.teamId,
        taskID: task.id,
        sessionID: task.sessionID,
        type: "task_cancelled",
        payload: { reason: "queued_cancel" },
      })
      if (task.teamId && task.coordinationScope.length > 0) {
        SwarmTeamManager.releaseClaims({
          ownerSessionID: task.sessionID,
          scopes: task.coordinationScope,
          status: "cancelled",
        })
      }
      return task
    }

    const running = s.running.get(id)
    if (!running) {
      task.status = "cancelled"
      task.endedAt = Date.now()
      task.durationMs = (task.endedAt ?? task.createdAt) - (task.startedAt ?? task.createdAt)
      await persistTask(task)
      if (task.teamId && task.coordinationScope.length > 0) {
        SwarmTeamManager.releaseClaims({
          ownerSessionID: task.sessionID,
          scopes: task.coordinationScope,
          status: "cancelled",
        })
      }
      return task
    }

    running.abort.abort()
    running.cancel()
    SwarmWatchdog.clear(id)
    s.running.delete(id)
    s.runners.delete(id)
    task.status = "cancelled"
    task.endedAt = Date.now()
    task.durationMs = (task.endedAt ?? task.createdAt) - (task.startedAt ?? task.createdAt)
    s.tasks.set(id, task)
    await persistTask(task)
    await SwarmTelemetry.event({
      teamID: task.teamId,
      taskID: task.id,
      sessionID: task.sessionID,
      type: "task_cancelled",
      payload: { reason: "running_cancel" },
    })
    if (task.teamId && task.coordinationScope.length > 0) {
      SwarmTeamManager.releaseClaims({
        ownerSessionID: task.sessionID,
        scopes: task.coordinationScope,
        status: "cancelled",
      })
    }
    void runQueue()
    return task
  }

  async function runQueue() {
    const s = state()
    if (!s.queue.length) return
    const limits = await resolveConcurrencyLimits()
    let remaining = s.queue.length

    while (s.queue.length && remaining > 0) {
      remaining -= 1
      const next = s.queue.shift()
      if (!next) return
      const task = s.tasks.get(next)
      if (!task || task.status !== "queued") {
        continue
      }
      if (task.teamId) {
        const team = SwarmTeamManager.get(task.teamId)
        if (team?.status === "stopped") {
          task.status = "cancelled"
          task.error = "Team is stopped"
          task.endedAt = Date.now()
          task.durationMs = (task.endedAt ?? task.createdAt) - (task.startedAt ?? task.createdAt)
          s.tasks.set(task.id, task)
          await persistTask(task)
          await SwarmTelemetry.event({
            teamID: task.teamId,
            taskID: task.id,
            sessionID: task.sessionID,
            type: "task_cancelled",
            payload: { reason: "team_stopped" },
          })
          if (task.coordinationScope.length > 0) {
            SwarmTeamManager.releaseClaims({
              ownerSessionID: task.sessionID,
              scopes: task.coordinationScope,
              status: "cancelled",
            })
          }
          continue
        }
        if (team?.status === "paused") {
          s.queue.push(task.id)
          continue
        }
      }
      if (!canRunTask(task, limits)) {
        s.queue.push(task.id)
        continue
      }
      void launchTask(task)
    }
  }

  async function launchTask(task: TaskRecord) {
    const s = state()
    const runner = s.runners.get(task.id)
    if (!runner) {
      const match = s.tasks.get(task.id)
      if (match) {
        match.status = "failed"
        match.error = "Background task runner missing"
        match.endedAt = Date.now()
        match.durationMs = (match.endedAt ?? match.createdAt) - (match.startedAt ?? match.createdAt)
        s.tasks.set(match.id, match)
        await persistTask(match)
      }
      return
    }

    task.status = "running"
    task.startedAt = Date.now()
    s.tasks.set(task.id, task)

    const abort = new AbortController()
    s.running.set(task.id, {
      abort,
      run: runner.run,
      cancel: runner.cancel,
    })

    const touch = () => {
      SwarmWatchdog.touch({
        taskID: task.id,
        staleTimeoutMs: task.staleTimeoutMs,
        onStale: () => {
          const running = state().running.get(task.id)
          if (!running) return
          running.abort.abort()
          running.cancel()
          state().running.delete(task.id)
          const match = state().tasks.get(task.id)
          if (!match || match.status !== "running") return
          match.status = "stale_timeout"
          match.error = `Background task exceeded stale timeout (${match.staleTimeoutMs} ms)`
          match.endedAt = Date.now()
          match.durationMs = (match.endedAt ?? match.createdAt) - (match.startedAt ?? match.createdAt)
          state().tasks.set(match.id, match)
          void persistTask(match)
          void SwarmTelemetry.event({
            teamID: match.teamId,
            taskID: match.id,
            sessionID: match.sessionID,
            type: "task_stale_timeout",
            payload: {
              stale_timeout_ms: match.staleTimeoutMs,
            },
          })
          if (match.teamId && match.coordinationScope.length > 0) {
            SwarmTeamManager.releaseClaims({
              ownerSessionID: match.sessionID,
              scopes: match.coordinationScope,
              status: "failed",
            })
          }
          void runQueue()
        },
      })
    }

    touch()
    await persistTask(task)
    await SwarmTelemetry.event({
      teamID: task.teamId,
      taskID: task.id,
      sessionID: task.sessionID,
      type: "task_started",
      payload: {
        started_at: nowIso(task.startedAt),
        scheduler_lane: task.schedulerLane,
      },
    })

    if (task.teamId) {
      SwarmTeamManager.upsertMember({
        teamID: task.teamId,
        sessionID: task.sessionID,
        agentName: task.subagentType,
        role: "worker",
        lane: task.schedulerLane,
        state: "running",
      })
    }

    try {
      const result = await runner.run({ signal: abort.signal, touch })
      const match = state().tasks.get(task.id)
      if (!match || match.status === "cancelled") return
      match.status = "completed"
      match.output = result.output
      match.endedAt = Date.now()
      match.durationMs = (match.endedAt ?? match.createdAt) - (match.startedAt ?? match.createdAt)
      state().tasks.set(match.id, match)
      await persistTask(match)
      await SwarmTelemetry.event({
        teamID: match.teamId,
        taskID: match.id,
        sessionID: match.sessionID,
        type: "task_completed",
        payload: {
          ended_at: nowIso(match.endedAt),
          duration_ms: match.durationMs,
        },
      })
      if (match.teamId) {
        SwarmTeamManager.upsertMember({
          teamID: match.teamId,
          sessionID: match.sessionID,
          agentName: match.subagentType,
          role: "worker",
          lane: match.schedulerLane,
          state: "ready",
        })
      }
      if (match.teamId && match.coordinationScope.length > 0) {
        SwarmTeamManager.releaseClaims({
          ownerSessionID: match.sessionID,
          scopes: match.coordinationScope,
          status: "completed",
        })
      }
    } catch (error) {
      const match = state().tasks.get(task.id)
      if (!match || match.status === "cancelled") return
      const err = error instanceof Error ? error.message : String(error)
      const maxRetries = SwarmScheduler.maxRetries(match.retryPolicy)
      if (match.retryCount < maxRetries) {
        match.retryCount += 1
        match.status = "queued"
        match.error = err
        match.endedAt = undefined
        match.durationMs = undefined
        state().tasks.set(match.id, match)
        await persistTask(match)
        await SwarmTelemetry.event({
          teamID: match.teamId,
          taskID: match.id,
          sessionID: match.sessionID,
          type: "task_retry_scheduled",
          payload: {
            retry_count: match.retryCount,
            retry_policy: match.retryPolicy,
            delay_ms: SwarmScheduler.backoffMs(match.retryPolicy, match.retryCount),
            error: err,
          },
        })
        const delay = SwarmScheduler.backoffMs(match.retryPolicy, match.retryCount)
        setTimeout(() => {
          state().queue.push(match.id)
          void runQueue()
        }, delay)
      } else {
        match.status = "failed"
        match.error = err
        match.endedAt = Date.now()
        match.durationMs = (match.endedAt ?? match.createdAt) - (match.startedAt ?? match.createdAt)
        state().tasks.set(match.id, match)
        await persistTask(match)
        await SwarmTelemetry.event({
          teamID: match.teamId,
          taskID: match.id,
          sessionID: match.sessionID,
          type: "task_failed",
          payload: {
            error: err,
            retry_count: match.retryCount,
            ended_at: nowIso(match.endedAt),
          },
        })
        if (match.teamId && match.coordinationScope.length > 0) {
          SwarmTeamManager.releaseClaims({
            ownerSessionID: match.sessionID,
            scopes: match.coordinationScope,
            status: "failed",
          })
        }
        if (match.teamId) {
          SwarmTeamManager.upsertMember({
            teamID: match.teamId,
            sessionID: match.sessionID,
            agentName: match.subagentType,
            role: "worker",
            lane: match.schedulerLane,
            state: "ready",
          })
        }
      }
    } finally {
      SwarmWatchdog.clear(task.id)
      state().running.delete(task.id)
      state().runners.delete(task.id)
      void runQueue()
    }
  }

  async function resolveConcurrencyLimits() {
    const cfg = await Config.get()
    return {
      defaultConcurrency: Math.max(1, cfg.cyber?.background_task?.default_concurrency ?? 4),
      modelConcurrency: cfg.cyber?.background_task?.model_concurrency ?? {},
      providerConcurrency: cfg.cyber?.background_task?.provider_concurrency ?? {},
    }
  }

  function canRunTask(
    task: TaskRecord,
    limits: {
      defaultConcurrency: number
      modelConcurrency: globalThis.Record<string, number>
      providerConcurrency: globalThis.Record<string, number>
    },
  ) {
    return SwarmScheduler.canRun({
      lane: task.schedulerLane,
      providerID: task.providerID,
      modelID: task.modelID,
      defaultConcurrency: limits.defaultConcurrency,
      providerConcurrency: limits.providerConcurrency,
      modelConcurrency: limits.modelConcurrency,
    })
  }
}
