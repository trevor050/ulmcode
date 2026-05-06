import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_next.txt"
import { Instance } from "@/project/instance"
import { decideOperationNext, formatOperationNext } from "@/ulm/operation-next"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
})

type Metadata = {
  operationID: string
  action: string
  path: string
  laneID?: string
}

export const OperationNextTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_next",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => decideOperationNext(Instance.worktree, params)).pipe(
          Effect.orDie,
        )
        const laneID = "lane" in result.action ? result.action.lane.id : "laneID" in result.action ? result.action.laneID : undefined
        return {
          title: `Next action: ${result.action.action}`,
          output: formatOperationNext(result.action, result.path),
          metadata: {
            operationID: result.action.operationID,
            action: result.action.action,
            path: result.path,
            laneID,
          },
        }
      }),
  }),
)
