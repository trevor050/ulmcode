import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_run.txt"
import { Instance } from "@/project/instance"
import { formatOperationRun, runOperationStep } from "@/ulm/operation-run"
import { BackgroundJob } from "@/background/job"
import { TaskTool } from "./task"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  mode: Schema.optional(Schema.Literals(["advance", "complete_lane", "fail_lane"])),
  laneID: Schema.optional(Schema.String),
  jobID: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  artifacts: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Explicit operation-relative artifacts that prove complete_lane produced real output.",
  }),
  evidenceRefs: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Evidence/finding IDs referenced by the lane completion proof.",
  }),
  autoComplete: Schema.optional(Schema.Boolean),
  launchModelLane: Schema.optional(Schema.Boolean),
})

export const OperationRunTool = Tool.define(
  "operation_run",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const task = yield* TaskTool
    const taskDef = yield* task.init()
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx) =>
        Effect.gen(function* () {
          const backgroundJobs = yield* jobs.list()
          const result = yield* Effect.tryPromise(() =>
            runOperationStep(Instance.worktree, { ...params, backgroundJobs }),
          ).pipe(Effect.orDie)
          const launched =
            params.launchModelLane === true && result.taskParams
              ? yield* taskDef.execute(result.taskParams, ctx)
              : undefined
          const launchedTaskID =
            launched?.metadata && typeof launched.metadata === "object"
              ? Reflect.get(launched.metadata, "sessionId")
              : undefined
          return {
            title: `Operation run: ${result.action}`,
            output: [
              formatOperationRun(result),
              ...(launched ? ["", "## Launched Model Lane", "", launched.output] : []),
            ].join("\n"),
            metadata: {
              operationID: result.operationID,
              mode: result.mode,
              action: result.action,
              laneID: result.laneID,
              graphPath: result.graphPath,
              runLogPath: result.runLogPath,
              launchedTaskID: typeof launchedTaskID === "string" ? launchedTaskID : undefined,
            },
          }
        }),
    }
  }),
)
