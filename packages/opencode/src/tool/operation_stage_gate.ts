import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_stage_gate.txt"
import { Instance } from "@/project/instance"
import { buildOperationStageGate, formatOperationStageGate, STAGES } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  stage: Schema.optional(Schema.Literals(["intake", "recon", "mapping", "validation", "reporting", "handoff"])).annotate({
    description: "Stage to check. Defaults to the operation checkpoint stage.",
  }),
})

type Metadata = {
  operationID: string
  stage: string
  ok: boolean
  gaps: string[]
  recommendedTools: string[]
  files: {
    json: string
    markdown: string
  }
}

export const OperationStageGateTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_stage_gate",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const stage =
          params.stage === undefined
            ? undefined
            : STAGES.includes(params.stage as (typeof STAGES)[number])
              ? (params.stage as (typeof STAGES)[number])
              : undefined
        if (params.stage !== undefined && stage === undefined) {
          return yield* Effect.die(`Invalid ULMCode stage: ${params.stage}`)
        }
        const result = yield* Effect.tryPromise(() =>
          buildOperationStageGate(Instance.worktree, params.operationID, {
            stage,
          }),
        ).pipe(Effect.orDie)
        return {
          title: result.ok ? `stage gate passed: ${result.stage}` : `${result.gaps.length} stage gate gaps`,
          output: [
            formatOperationStageGate(result),
            "<operation_stage_gate_json>",
            JSON.stringify(result, null, 2),
            "</operation_stage_gate_json>",
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            stage: result.stage,
            ok: result.ok,
            gaps: result.gaps,
            recommendedTools: result.recommendedTools,
            files: result.files,
          },
        }
      }),
  }),
)
