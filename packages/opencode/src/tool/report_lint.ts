import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./report_lint.txt"
import { Instance } from "@/project/instance"
import { lintReport } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
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
        const result = yield* Effect.tryPromise(() => lintReport(Instance.worktree, params.operationID)).pipe(Effect.orDie)
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
