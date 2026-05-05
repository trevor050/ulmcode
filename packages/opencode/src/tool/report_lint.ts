import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./report_lint.txt"
import { Instance } from "@/project/instance"
import { lintReport } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  requireReport: Schema.optional(Schema.Boolean).annotate({
    description: "Require reports/report.md or reports/report.html to exist.",
  }),
  minWords: Schema.optional(Schema.Number).annotate({
    description: "Minimum word count for the report when a report file exists.",
  }),
  requireOutlineBudget: Schema.optional(Schema.Boolean).annotate({
    description: "Require the report to satisfy the report-outline target page budget.",
  }),
  minOutlineWordsPerPage: Schema.optional(Schema.Number).annotate({
    description: "Minimum words per target outline page when enforcing outline budget. Defaults to 300.",
  }),
  requireFindingSections: Schema.optional(Schema.Boolean).annotate({
    description: "Require every validated/report-ready finding to have a matching section in the report.",
  }),
  minFindingWords: Schema.optional(Schema.Number).annotate({
    description: "Minimum word count for each validated/report-ready finding section when a report file exists.",
  }),
  finalHandoff: Schema.optional(Schema.Boolean).annotate({
    description:
      "Require final handoff readiness: operation is complete in handoff stage, operation plan exists, rendered deliverables exist, and runtime summary exists.",
  }),
  requireOperationPlan: Schema.optional(Schema.Boolean).annotate({
    description: "Require plans/operation-plan.json to exist.",
  }),
  requireRenderedDeliverables: Schema.optional(Schema.Boolean).annotate({
    description: "Require final HTML, PDF, and manifest deliverables to exist.",
  }),
  requireRuntimeSummary: Schema.optional(Schema.Boolean).annotate({
    description: "Require deliverables/runtime-summary.json to exist.",
  }),
})

type Metadata = {
  operationID: string
  ok: boolean
  gaps: string[]
}

export const ReportLintTool = Tool.define<typeof Parameters, Metadata, never>(
  "report_lint",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() =>
          lintReport(Instance.worktree, params.operationID, {
            requireReport: params.requireReport,
            minWords: params.minWords,
            requireOutlineBudget: params.requireOutlineBudget,
            minOutlineWordsPerPage: params.minOutlineWordsPerPage,
            requireFindingSections: params.requireFindingSections,
            minFindingWords: params.minFindingWords,
            finalHandoff: params.finalHandoff,
            requireOperationPlan: params.requireOperationPlan,
            requireRenderedDeliverables: params.requireRenderedDeliverables,
            requireRuntimeSummary: params.requireRuntimeSummary,
          }),
        ).pipe(Effect.orDie)
        return {
          title: result.ok ? "report lint passed" : `${result.gaps.length} report gaps`,
          output: JSON.stringify(result, null, 2),
          metadata: {
            operationID: result.operationID,
            ok: result.ok,
            gaps: result.gaps,
          },
        }
      }),
  }),
)
