import * as Tool from "./tool"
import DESCRIPTION from "./operation_recover.txt"
import { BackgroundJob } from "@/background/job"
import { taskRestartArgs } from "./task_restart_args"
import { TaskTool } from "./task"
import { Effect, Schema } from "effect"

export const Parameters = Schema.Struct({
  operationID: Schema.String.annotate({ description: "ULMCode operation ID whose restartable background tasks should recover." }),
  dryRun: Schema.optional(Schema.Boolean).annotate({
    description: "When true, report restartable tasks without launching them.",
  }),
  maxTasks: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of restartable tasks to launch. Defaults to all restartable tasks.",
  }),
})

type Metadata = {
  operationID: string
  restarted: number
  skipped: number
  dryRun: boolean
}

function operationID(job: BackgroundJob.Info) {
  const value = job.metadata?.operationID
  return typeof value === "string" && value ? value : undefined
}

function recoverableStatus(status: BackgroundJob.Status) {
  return status === "stale" || status === "error" || status === "cancelled"
}

export const OperationRecoverTool = Tool.define(
  "operation_recover",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const task = yield* TaskTool
    const taskDef = yield* task.init()

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const dryRun = params.dryRun === true
          const maxTasks = params.maxTasks === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(params.maxTasks))
          const candidates = (yield* jobs.list())
            .filter((job) => operationID(job) === params.operationID)
            .filter((job) => recoverableStatus(job.status))
            .map((job) => ({ job, restartArgs: taskRestartArgs(job) }))
          const restartable = candidates.filter((item) => item.restartArgs !== undefined).slice(0, maxTasks)
          const skipped = candidates.length - restartable.length
          const results: string[] = []

          if (!dryRun) {
            for (const item of restartable) {
              const restarted = yield* taskDef.execute(item.restartArgs!, ctx)
              results.push([`task_id: ${item.job.id}`, `previous_status: ${item.job.status}`, restarted.output].join("\n"))
            }
          }

          return {
            title: dryRun ? `Recover ${params.operationID}: dry run` : `Recover ${params.operationID}`,
            output: restartable.length
              ? dryRun
                ? restartable
                    .map((item) =>
                      [
                        `task_id: ${item.job.id}`,
                        `previous_status: ${item.job.status}`,
                        `restart_args: ${JSON.stringify(item.restartArgs)}`,
                      ].join("\n"),
                    )
                    .join("\n\n")
                : results.join("\n\n")
              : "No restartable background tasks found for this operation.",
            metadata: {
              operationID: params.operationID,
              restarted: dryRun ? 0 : restartable.length,
              skipped,
              dryRun,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
