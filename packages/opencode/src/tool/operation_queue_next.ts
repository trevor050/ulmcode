import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_queue_next.txt"
import { Instance } from "@/project/instance"
import { formatWorkQueueNext, nextWorkUnits } from "@/ulm/work-queue"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  laneID: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  claim: Schema.optional(Schema.Boolean),
})

type Metadata = {
  operationID: string
  queuePath: string
  selected: number
}

export const OperationQueueNextTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_queue_next",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => nextWorkUnits(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Selected ${result.units.length} work units`,
          output: formatWorkQueueNext(result),
          metadata: {
            operationID: result.operationID,
            queuePath: result.queuePath,
            selected: result.units.length,
          },
        }
      }),
  }),
)
