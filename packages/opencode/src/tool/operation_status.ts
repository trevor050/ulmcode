import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_status.txt"
import { Instance } from "@/project/instance"
import { formatOperationStatusDashboard, readOperationStatus } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  eventLimit: Schema.optional(Schema.Number),
})

type Metadata = {
  operationID: string
  root: string
  status?: string
  stage?: string
}

export const OperationStatusTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_status",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() =>
          readOperationStatus(Instance.worktree, params.operationID, { eventLimit: params.eventLimit }),
        ).pipe(Effect.orDie)
        return {
          title: result.operation
            ? `${result.operationID}: ${result.operation.stage}/${result.operation.status}`
            : `${result.operationID}: no operation checkpoint`,
          output: [
            formatOperationStatusDashboard(result),
            "<operation_status_json>",
            JSON.stringify(result, null, 2),
            "</operation_status_json>",
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            root: result.root,
            status: result.operation?.status,
            stage: result.operation?.stage,
          },
        }
      }),
  }),
)
