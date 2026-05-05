import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./report_outline.txt"
import { Instance } from "@/project/instance"
import { writeReportOutline } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  audience: Schema.optional(Schema.Literals(["technical", "executive", "board", "mixed"])),
  targetPages: Schema.optional(Schema.Number),
  includeAppendix: Schema.optional(Schema.Boolean),
})

type Metadata = {
  operationID: string
  file: string
  targetPages: number
  reportReady: number
}

export const ReportOutlineTool = Tool.define<typeof Parameters, Metadata, never>(
  "report_outline",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeReportOutline(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `${result.targetPages}-page report outline`,
          output: [
            `operation_id: ${params.operationID}`,
            `outline: ${result.file}`,
            `target_pages: ${result.targetPages}`,
            `reportable_findings: ${result.reportReady}`,
          ].join("\n"),
          metadata: {
            operationID: params.operationID,
            file: result.file,
            targetPages: result.targetPages,
            reportReady: result.reportReady,
          },
        }
      }),
  }),
)
