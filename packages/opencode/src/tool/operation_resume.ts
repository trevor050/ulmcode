import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_resume.txt"
import { BackgroundJob } from "@/background/job"
import { Instance } from "@/project/instance"
import { InstanceState } from "@/effect/instance-state"
import { commandRestartArgs, taskRestartArgs } from "./task_restart_args"
import { TaskTool } from "./task"
import { CommandSuperviseTool } from "./command_supervise"
import { buildOperationResumeBrief, formatOperationResumeBrief, readOperationStatus, writeOperationCheckpoint } from "@/ulm/artifact"
import { markRecoveredLanesRunning } from "@/ulm/operation-recovery"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  eventLimit: Schema.optional(Schema.Number),
  staleAfterMinutes: Schema.optional(Schema.Number),
  recoverStaleTasks: Schema.optional(Schema.Boolean).annotate({
    description: "When true, restart stale, errored, or cancelled background lanes with saved task metadata before returning the refreshed resume brief.",
  }),
  maxRecoveries: Schema.optional(Schema.Number).annotate({
    description: "Maximum stale lanes to restart when recoverStaleTasks is true. Defaults to all restartable lanes.",
  }),
})

function operationID(job: BackgroundJob.Info) {
  const value = job.metadata?.operationID
  return typeof value === "string" && value ? value : undefined
}

function metadataWorktree(job: BackgroundJob.Info) {
  const value = job.metadata?.worktree
  return typeof value === "string" && value ? value : undefined
}

function recoverableStatus(status: BackgroundJob.Status) {
  return status === "stale" || status === "error" || status === "cancelled"
}

const currentWorktree = Effect.gen(function* () {
  const ctx = yield* InstanceState.context.pipe(Effect.option)
  if (ctx._tag === "Some") return ctx.value.worktree
  return Instance.worktree
})

export const OperationResumeTool = Tool.define(
  "operation_resume",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const task = yield* TaskTool
    const taskDef = yield* task.init()
    const command = yield* CommandSuperviseTool
    const commandDef = yield* command.init()

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const recovery = yield* Effect.gen(function* () {
            if (params.recoverStaleTasks !== true) return undefined
            const maxRecoveries =
              params.maxRecoveries === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(params.maxRecoveries))
            const candidates = (yield* jobs.list())
              .filter((job) => operationID(job) === params.operationID)
              .filter((job) => recoverableStatus(job.status))
              .map((job) => ({ job, taskArgs: taskRestartArgs(job), commandArgs: commandRestartArgs(job) }))
            const restartable = candidates.filter((item) => item.taskArgs !== undefined || item.commandArgs !== undefined).slice(0, maxRecoveries)
            const skipped = candidates.length - restartable.length
            const restarted: string[] = []

            for (const item of restartable) {
              const result = item.taskArgs
                ? yield* taskDef.execute(item.taskArgs, ctx)
                : yield* commandDef.execute(item.commandArgs!, ctx)
              restarted.push(
                [
                  item.job.type === "task" ? `task_id: ${item.job.id}` : `command_job_id: ${item.job.id}`,
                  `job_type: ${item.job.type}`,
                  `previous_status: ${item.job.status}`,
                  result.output,
                ].join("\n"),
              )
            }

            const checkpointUpdated = yield* Effect.gen(function* () {
              if (restartable.length === 0) return false
              const worktree = restartable.map((item) => metadataWorktree(item.job)).find(Boolean) ?? (yield* currentWorktree)
              const status = yield* Effect.tryPromise(() => readOperationStatus(worktree, params.operationID)).pipe(
                Effect.catch(() => Effect.succeed(undefined)),
              )
              if (!status?.operation) return false
              const operation = status.operation
              yield* Effect.tryPromise(() =>
                markRecoveredLanesRunning(worktree, { operationID: params.operationID, jobs: restartable.map((item) => item.job) }),
              ).pipe(Effect.ignore)
              yield* Effect.tryPromise(() =>
                writeOperationCheckpoint(worktree, {
                  operationID: operation.operationID,
                  objective: operation.objective,
                  stage: operation.stage,
                  status: "running",
                  summary: `Recovered ${restartable.length} background lane${restartable.length === 1 ? "" : "s"} during operation resume.`,
                  nextActions: [...new Set([...operation.nextActions, "Poll recovered background lanes with task_status"])],
                  blockers: operation.blockers,
                  riskLevel: operation.riskLevel,
                  activeTasks: [...new Set([...operation.activeTasks, ...restartable.map((item) => item.job.id)])],
                  evidence: operation.evidence,
                  notes: operation.notes,
                }),
              ).pipe(Effect.orDie)
              return true
            })

            return {
              requested: true,
              restarted: restartable.length,
              skipped,
              checkpointUpdated,
              output: restarted.join("\n\n"),
            }
          })

          const worktree = yield* currentWorktree
          const result = yield* Effect.tryPromise(() =>
            buildOperationResumeBrief(worktree, params.operationID, {
              eventLimit: params.eventLimit,
              staleAfterMinutes: params.staleAfterMinutes,
            }),
          ).pipe(Effect.orDie)
          const recoveryLines = recovery
            ? [
                "recovery:",
                `- requested: true`,
                `- restarted: ${recovery.restarted}`,
                `- skipped: ${recovery.skipped}`,
                `- checkpoint_updated: ${recovery.checkpointUpdated}`,
                recovery.output ? `\n${recovery.output}` : undefined,
                "",
              ].filter((item): item is string => item !== undefined)
            : []
          return {
            title: `Resume ${result.operationID}: ${result.health.status}`,
            output: [
              ...recoveryLines,
              formatOperationResumeBrief(result),
              "<operation_resume_json>",
              JSON.stringify(result, null, 2),
              "</operation_resume_json>",
            ].join("\n"),
            metadata: {
              operationID: result.operationID,
              root: result.root,
              health: result.health,
              ...(recovery
                ? {
                    recovery: {
                      requested: true,
                      restarted: recovery.restarted,
                      skipped: recovery.skipped,
                      checkpointUpdated: recovery.checkpointUpdated,
                    },
                  }
                : {}),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
