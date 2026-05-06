import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_schedule.txt"
import { Instance } from "@/project/instance"
import { writeOperationGraph } from "@/ulm/operation-graph"

const ModelRoutes = Schema.Record(Schema.String, Schema.String)

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  safetyMode: Schema.optional(Schema.Literals(["non_destructive", "interactive_destructive"])),
  maxConcurrentLanes: Schema.optional(Schema.Number),
  budgetUSD: Schema.optional(Schema.Number),
  modelRoutes: Schema.optional(ModelRoutes),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
  lanes: number
}

export const OperationScheduleTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_schedule",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeOperationGraph(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Scheduled ${result.lanes} operation lanes`,
          output: [
            `operation_id: ${result.operationID}`,
            `json: ${result.json}`,
            `markdown: ${result.markdown}`,
            `lanes: ${result.lanes}`,
          ].join("\n"),
          metadata: result,
        }
      }),
  }),
)
