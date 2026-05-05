import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./report_render.txt"
import { Instance } from "@/project/instance"
import { renderReport } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  title: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  html: string
  manifest: string
  findings: number
}

export const ReportRenderTool = Tool.define<typeof Parameters, Metadata, never>(
  "report_render",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => renderReport(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: "Rendered ULMCode report",
          output: [
            `operation_id: ${result.operationID}`,
            `html: ${result.html}`,
            `manifest: ${result.manifest}`,
            `findings: ${result.findings}`,
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            html: result.html,
            manifest: result.manifest,
            findings: result.findings,
          },
        }
      }),
  }),
)
