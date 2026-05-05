import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_resume.txt"
import { Instance } from "@/project/instance"
import { buildOperationResumeBrief, formatOperationResumeBrief } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  eventLimit: Schema.optional(Schema.Number),
})

type Metadata = {
  operationID: string
  root: string
  health: {
    ready: boolean
    status: "ready" | "attention_required"
    gaps: string[]
  }
}

export const OperationResumeTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_resume",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() =>
          buildOperationResumeBrief(Instance.worktree, params.operationID, { eventLimit: params.eventLimit }),
        ).pipe(Effect.orDie)
        return {
          title: `Resume ${result.operationID}: ${result.health.status}`,
          output: [
            formatOperationResumeBrief(result),
            "<operation_resume_json>",
            JSON.stringify(result, null, 2),
            "</operation_resume_json>",
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            root: result.root,
            health: result.health,
          },
        }
      }),
  }),
)
