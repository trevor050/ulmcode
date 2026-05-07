import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./eval_scorecard.txt"
import { Instance } from "@/project/instance"
import { writeEvalScorecard } from "@/ulm/artifact"

const Budget = Schema.Struct({
  maxHours: Schema.optional(Schema.Number),
  maxUSD: Schema.optional(Schema.Number),
})

const Metrics = Schema.Struct({
  passed: Schema.Boolean,
  timeToFirstSignalMs: Schema.optional(Schema.Number),
  validatedFindings: Schema.Number,
  falsePositives: Schema.Number,
  toolFailures: Schema.Number,
  retries: Schema.Number,
  costUSD: Schema.optional(Schema.Number),
  reportQuality: Schema.Literals(["passed", "failed", "not_checked"]),
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  target: Schema.String,
  sandbox: Schema.optional(Schema.String),
  allowedProfiles: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  successCriteria: Schema.mutable(Schema.Array(Schema.String)),
  artifactRequirements: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  mitreTags: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  budget: Schema.optional(Budget),
  metrics: Metrics,
  notes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
}

export const EvalScorecardTool = Tool.define<typeof Parameters, Metadata, never>(
  "eval_scorecard",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeEvalScorecard(Instance.worktree, params)).pipe(
          Effect.orDie,
        )
        return {
          title: "eval scorecard written",
          output: [
            `Wrote eval scorecard for ${result.operationID}.`,
            "",
            `- json: ${result.json}`,
            `- markdown: ${result.markdown}`,
            "",
            "<eval_scorecard_json>",
            JSON.stringify(result, null, 2),
            "</eval_scorecard_json>",
          ].join("\n"),
          metadata: result,
        }
      }),
  }),
)
