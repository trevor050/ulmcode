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
  requireReport: Schema.optional(Schema.Boolean).annotate({
    description: "Require reports/report.md or reports/report.html to exist for handoff gates.",
  }),
  minWords: Schema.optional(Schema.Number).annotate({
    description: "Minimum word count for the report when a report file exists.",
  }),
  requireOutlineBudget: Schema.optional(Schema.Boolean).annotate({
    description: "Require the report to satisfy the report-outline target page budget for handoff gates.",
  }),
  minOutlineWordsPerPage: Schema.optional(Schema.Number).annotate({
    description: "Minimum words per target outline page when enforcing outline budget. Defaults to 300.",
  }),
  requireOutlineSections: Schema.optional(Schema.Boolean).annotate({
    description: "Require every Page Budget section from reports/report-outline.md to appear in the report.",
  }),
  minOutlineSectionWords: Schema.optional(Schema.Number).annotate({
    description:
      "Minimum absolute word count for each Page Budget section. Overrides the per-page outline section default.",
  }),
  minOutlineSectionWordsPerPage: Schema.optional(Schema.Number).annotate({
    description:
      "Minimum words per allocated outline page for each Page Budget section. Defaults to 120 when enforcing outline sections.",
  }),
  requireFindingSections: Schema.optional(Schema.Boolean).annotate({
    description: "Require every validated/report-ready finding to have a matching section in the report.",
  }),
  minFindingWords: Schema.optional(Schema.Number).annotate({
    description: "Minimum word count for each validated/report-ready finding section when a report file exists.",
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
            requireReport: params.requireReport,
            minWords: params.minWords,
            requireOutlineBudget: params.requireOutlineBudget,
            minOutlineWordsPerPage: params.minOutlineWordsPerPage,
            requireOutlineSections: params.requireOutlineSections,
            minOutlineSectionWords: params.minOutlineSectionWords,
            minOutlineSectionWordsPerPage: params.minOutlineSectionWordsPerPage,
            requireFindingSections: params.requireFindingSections,
            minFindingWords: params.minFindingWords,
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
