import { Effect, Schema, Scope } from "effect"
import { BackgroundJob } from "@/background/job"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Instance } from "@/project/instance"
import { formatRuntimeScheduler, runRuntimeScheduler } from "@/ulm/runtime-scheduler"
import * as Tool from "./tool"
import DESCRIPTION from "./runtime_scheduler.txt"
import { TaskTool } from "./task"
import * as Truncate from "./truncate"
import { CommandSuperviseTool } from "./command_supervise"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  maxCycles: Schema.optional(Schema.Number).annotate({
    description: "Maximum scheduler cycles to run before returning. Defaults to 1.",
  }),
  leaseSeconds: Schema.optional(Schema.Number).annotate({
    description: "Requeue claimed work units without a job binding after this many seconds. Defaults to 600.",
  }),
})

type Metadata = {
  operationID: string
  heartbeatPath: string
  logPath: string
  cycles: number
  stopped: boolean
}

export const RuntimeSchedulerTool = Tool.define<
  typeof Parameters,
  Metadata,
  | BackgroundJob.Service
  | Agent.Service
  | Bus.Service
  | Config.Service
  | Session.Service
  | SessionStatus.Service
  | Scope.Scope
  | Truncate.Service
>(
  "runtime_scheduler",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const task = yield* TaskTool
    const taskDef = yield* task.init()
    const command = yield* CommandSuperviseTool
    const commandDef = yield* command.init()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx) =>
        Effect.gen(function* () {
          const backgroundJobs = yield* jobs.list()
          const result = yield* Effect.tryPromise(() =>
            runRuntimeScheduler(Instance.worktree, {
              ...params,
              backgroundJobs,
              launchModelLane: (launchParams) =>
                Effect.runPromise(
                  taskDef.execute(launchParams, {
                    ...ctx,
                    extra: { ...ctx.extra, bypassAgentCheck: true },
                  }),
                ).then((launched) => ({
                  jobID:
                    launched.metadata && typeof launched.metadata === "object"
                      ? Reflect.get(launched.metadata, "sessionId")
                    : undefined,
                })),
              launchCommandWorkUnit: (commandParams) =>
                Effect.runPromise(commandDef.execute({ ...commandParams, dryRun: false }, ctx)).then((launched) => ({
                  jobID:
                    launched.metadata && typeof launched.metadata === "object"
                      ? Reflect.get(launched.metadata, "jobID")
                      : undefined,
                })),
            }),
          ).pipe(Effect.orDie)
          return {
            title: `Runtime scheduler: ${result.cycles.length} cycles`,
            output: formatRuntimeScheduler(result),
            metadata: {
              operationID: result.operationID,
              heartbeatPath: result.heartbeatPath,
              logPath: result.logPath,
              cycles: result.cycles.length,
              stopped: result.stopped,
            },
          }
        }),
    }
  }),
)
