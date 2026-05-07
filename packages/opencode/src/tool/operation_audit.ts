import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_audit.txt"
import { Instance } from "@/project/instance"
import { buildOperationAudit, formatOperationAudit } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  eventLimit: Schema.optional(Schema.Number),
  staleAfterMinutes: Schema.optional(Schema.Number),
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
  finalHandoff: Schema.optional(Schema.Boolean).annotate({
    description: "Require final handoff readiness. Defaults to true.",
  }),
})

type Metadata = {
  operationID: string
  ok: boolean
  blockers: string[]
  recommendedTools: string[]
  files: {
    json: string
    markdown: string
  }
}

export const OperationAuditTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_audit",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() =>
          buildOperationAudit(Instance.worktree, params.operationID, {
            eventLimit: params.eventLimit,
            staleAfterMinutes: params.staleAfterMinutes,
            requireReport: params.requireReport,
            minWords: params.minWords,
            requireOutlineBudget: params.requireOutlineBudget,
            minOutlineWordsPerPage: params.minOutlineWordsPerPage,
            requireOutlineSections: params.requireOutlineSections,
            minOutlineSectionWords: params.minOutlineSectionWords,
            minOutlineSectionWordsPerPage: params.minOutlineSectionWordsPerPage,
            requireFindingSections: params.requireFindingSections,
            minFindingWords: params.minFindingWords,
            finalHandoff: params.finalHandoff,
          }),
        ).pipe(Effect.orDie)
        return {
          title: result.ok ? "operation audit passed" : `${result.blockers.length} operation audit blockers`,
          output: [
            formatOperationAudit(result),
            "<operation_audit_json>",
            JSON.stringify(result, null, 2),
            "</operation_audit_json>",
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            ok: result.ok,
            blockers: result.blockers,
            recommendedTools: result.recommendedTools,
            files: result.files,
          },
        }
      }),
  }),
)
