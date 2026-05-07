import * as Tool from "./tool"
import DESCRIPTION from "./task_restart.txt"
import { BackgroundJob } from "@/background/job"
import { taskRestartArgs } from "./task_restart_args"
import { TaskTool } from "./task"
import { Effect, Schema } from "effect"

export const Parameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "The stale/error/cancelled background task id to restart." }),
})

export const TaskRestartTool = Tool.define(
  "task_restart",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const task = yield* TaskTool
    const taskDef = yield* task.init()

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const job = yield* jobs.get(params.task_id)
          if (!job) return yield* Effect.fail(new Error(`Background task ${params.task_id} was not found`))
          if (job.status === "running") return yield* Effect.fail(new Error(`Background task ${params.task_id} is still running`))
          const restartArgs = taskRestartArgs(job)
          if (!restartArgs) return yield* Effect.fail(new Error(`Background task ${params.task_id} has no restart args`))

          const restarted = yield* taskDef.execute(restartArgs, ctx)
          return {
            title: `Restarted ${params.task_id}`,
            output: restarted.output,
            metadata: {
              task_id: params.task_id,
              previous_status: job.status,
              restarted: true,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
