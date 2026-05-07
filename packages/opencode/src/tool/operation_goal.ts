import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_goal.txt"
import { Instance } from "@/project/instance"
import { completeOperationGoal, createOperationGoal, readOperationGoal } from "@/ulm/operation-goal"

const CompletionPolicy = Schema.Struct({
  requiresOperationAudit: Schema.optional(Schema.Boolean),
  requiresRuntimeSummary: Schema.optional(Schema.Boolean),
  requiresReportRender: Schema.optional(Schema.Boolean),
  requiresStageGate: Schema.optional(Schema.String),
})

const Continuation = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  idleMinutesBeforeReview: Schema.optional(Schema.Number),
  maxNoToolContinuationTurns: Schema.optional(Schema.Number),
  turnEndReview: Schema.optional(Schema.Boolean),
  injectPlanMaxChars: Schema.optional(Schema.Number),
  operatorFallbackTimeoutSeconds: Schema.optional(Schema.Number),
  operatorFallbackEnabled: Schema.optional(Schema.Boolean),
  maxRepeatedOperatorTimeoutsPerKind: Schema.optional(Schema.Number),
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  action: Schema.Literals(["create", "read", "complete"]),
  objective: Schema.optional(Schema.String),
  targetDurationHours: Schema.optional(Schema.Number),
  completionPolicy: Schema.optional(CompletionPolicy),
  continuation: Schema.optional(Continuation),
})

type Metadata = {
  operationID: string
  action: "create" | "read" | "complete"
  status?: string
  created?: boolean
  completed?: boolean
  blockers?: string[]
  files: {
    json: string
    markdown: string
    blockers: string
  }
}

export const OperationGoalTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_goal",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        if (params.action === "create") {
          if (!params.objective?.trim()) throw new Error("objective is required when action is create")
          const result = yield* Effect.tryPromise(() =>
            createOperationGoal(Instance.worktree, {
              operationID: params.operationID,
              objective: params.objective!,
              targetDurationHours: params.targetDurationHours,
              completionPolicy: params.completionPolicy,
              continuation: params.continuation,
            }),
          ).pipe(Effect.orDie)
          return {
            title: result.created ? `Created operation goal for ${result.operationID}` : `Read active operation goal for ${result.operationID}`,
            output: [
              `operation_id: ${result.operationID}`,
              `status: ${result.goal.status}`,
              `created: ${result.created}`,
              `json: ${result.files.json}`,
              `markdown: ${result.files.markdown}`,
              "<operation_goal_json>",
              JSON.stringify(result.goal, null, 2),
              "</operation_goal_json>",
            ].join("\n"),
            metadata: {
              operationID: result.operationID,
              action: "create",
              status: result.goal.status,
              created: result.created,
              files: result.files,
            },
          }
        }

        if (params.action === "complete") {
          const result = yield* Effect.tryPromise(() => completeOperationGoal(Instance.worktree, params)).pipe(Effect.orDie)
          return {
            title: result.completed
              ? `Completed operation goal for ${result.operationID}`
              : `${result.blockers.length} operation goal completion blockers`,
            output: [
              `operation_id: ${result.operationID}`,
              `completed: ${result.completed}`,
              `blockers: ${result.blockers.length}`,
              `json: ${result.files.json}`,
              `markdown: ${result.files.markdown}`,
              result.blockers.length ? `blockers_json: ${result.files.blockers}` : undefined,
              "<operation_goal_json>",
              JSON.stringify({ goal: result.goal, blockers: result.blockers }, null, 2),
              "</operation_goal_json>",
            ]
              .filter((line): line is string => line !== undefined)
              .join("\n"),
            metadata: {
              operationID: result.operationID,
              action: "complete",
              status: result.goal?.status,
              completed: result.completed,
              blockers: result.blockers,
              files: result.files,
            },
          }
        }

        const result = yield* Effect.tryPromise(() => readOperationGoal(Instance.worktree, params.operationID)).pipe(Effect.orDie)
        return {
          title: result.goal ? `Read operation goal for ${result.operationID}` : `No operation goal for ${result.operationID}`,
          output: [
            `operation_id: ${result.operationID}`,
            `exists: ${result.goal !== undefined}`,
            `json: ${result.files.json}`,
            `markdown: ${result.files.markdown}`,
            "<operation_goal_json>",
            JSON.stringify(result.goal ?? null, null, 2),
            "</operation_goal_json>",
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            action: "read",
            status: result.goal?.status,
            files: result.files,
          },
        }
      }),
  }),
)
