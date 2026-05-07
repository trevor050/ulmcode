import { Effect, Schema, Scope } from "effect"
import { BackgroundJob } from "@/background/job"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Instance } from "@/project/instance"
import { formatRuntimeDaemon, runRuntimeDaemon } from "@/ulm/runtime-daemon"
import * as Tool from "./tool"
import DESCRIPTION from "./runtime_daemon.txt"
import { TaskTool } from "./task"
import * as Truncate from "./truncate"
import { CommandSuperviseTool } from "./command_supervise"
import { commandRestartArgs, taskRestartArgs } from "./task_restart_args"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  maxRuntimeSeconds: Schema.optional(Schema.Number).annotate({
    description: "Maximum wall-clock seconds before returning. Defaults to 72000.",
  }),
  cycleIntervalSeconds: Schema.optional(Schema.Number).annotate({
    description: "Seconds to sleep between scheduler ticks. Defaults to 60.",
  }),
  maxCycles: Schema.optional(Schema.Number).annotate({
    description: "Maximum daemon ticks before returning.",
  }),
  schedulerCyclesPerTick: Schema.optional(Schema.Number).annotate({
    description: "Scheduler cycles per daemon tick. Defaults to 1.",
  }),
  leaseSeconds: Schema.optional(Schema.Number).annotate({
    description: "Requeue claimed work units without a job binding after this many seconds.",
  }),
  errorBackoffSeconds: Schema.optional(Schema.Number).annotate({
    description: "Seconds to sleep after a failed scheduler tick. Defaults to 30.",
  }),
  maxConsecutiveErrors: Schema.optional(Schema.Number).annotate({
    description: "Stop after this many consecutive scheduler failures. Defaults to 3.",
  }),
  staleLockSeconds: Schema.optional(Schema.Number).annotate({
    description: "Replace daemon locks older than this many seconds. Defaults to 900.",
  }),
})

type Metadata = {
  operationID: string
  heartbeatPath: string
  logPath: string
  cycles: number
  stopped: boolean
  reason: string
}

export const RuntimeDaemonTool = Tool.define<
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
  "runtime_daemon",
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
          const result = yield* Effect.tryPromise(() =>
            runRuntimeDaemon(Instance.worktree, {
              ...params,
              backgroundJobProvider: () => Effect.runPromise(jobs.list()),
              recoverBackgroundJob: (job) => {
                const taskArgs = taskRestartArgs(job)
                if (taskArgs) {
                  return Effect.runPromise(
                    taskDef.execute(taskArgs, {
                      ...ctx,
                      extra: { ...ctx.extra, bypassAgentCheck: true },
                    }),
                  ).then((launched) => ({
                    jobID:
                      launched.metadata && typeof launched.metadata === "object"
                        ? Reflect.get(launched.metadata, "sessionId")
                        : undefined,
                  }))
                }
                const commandArgs = commandRestartArgs(job)
                if (!commandArgs) return Promise.resolve(undefined)
                return Effect.runPromise(commandDef.execute(commandArgs, ctx)).then((launched) => ({
                  jobID:
                    launched.metadata && typeof launched.metadata === "object"
                      ? Reflect.get(launched.metadata, "jobID")
                      : undefined,
                }))
              },
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
            title: `Runtime daemon: ${result.cycles.length} cycles`,
            output: formatRuntimeDaemon(result),
            metadata: {
              operationID: result.operationID,
              heartbeatPath: result.heartbeatPath,
              logPath: result.logPath,
              cycles: result.cycles.length,
              stopped: result.stopped,
              reason: result.reason,
            },
          }
        }),
    }
  }),
)
