import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_plan.txt"
import { Instance } from "@/project/instance"
import { writeOperationPlan } from "@/ulm/artifact"

const Phase = Schema.Struct({
  stage: Schema.Literals(["intake", "recon", "mapping", "validation", "reporting", "handoff"]),
  objective: Schema.String,
  actions: Schema.mutable(Schema.Array(Schema.String)),
  successCriteria: Schema.mutable(Schema.Array(Schema.String)),
  subagents: Schema.mutable(Schema.Array(Schema.String)),
  noSubagents: Schema.mutable(Schema.Array(Schema.String)),
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  assumptions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  phases: Schema.mutable(Schema.Array(Phase)),
  reportingCloseout: Schema.mutable(Schema.Array(Schema.String)),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
  phases: number
}

export const OperationPlanTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_plan",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeOperationPlan(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Wrote operation plan for ${result.operationID}`,
          output: [
            `operation_id: ${result.operationID}`,
            `json: ${result.json}`,
            `markdown: ${result.markdown}`,
            `phases: ${result.phases}`,
          ].join("\n"),
          metadata: result,
        }
      }),
  }),
)
