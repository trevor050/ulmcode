import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_queue.txt"
import { Instance } from "@/project/instance"
import { buildWorkQueue, formatWorkQueue } from "@/ulm/work-queue"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  manifestPath: Schema.optional(Schema.String),
  maxUnits: Schema.optional(Schema.Number),
  includePassiveBaseline: Schema.optional(Schema.Boolean),
  wordlist: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  queuePath: string
  generated: number
  total: number
}

export const OperationQueueTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_queue",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => buildWorkQueue(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Queued ${result.generated} work units`,
          output: formatWorkQueue(result),
          metadata: {
            operationID: result.operationID,
            queuePath: result.queuePath,
            generated: result.generated,
            total: result.units.length,
          },
        }
      }),
  }),
)
