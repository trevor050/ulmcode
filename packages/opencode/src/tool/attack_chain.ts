import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./attack_chain.txt"
import { Instance } from "@/project/instance"
import { writeAttackChain } from "@/ulm/operation-extras"

const Step = Schema.Struct({
  title: Schema.String,
  findingID: Schema.optional(Schema.String),
  assetID: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  notes: Schema.optional(Schema.String),
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  chainID: Schema.optional(Schema.String),
  title: Schema.String,
  summary: Schema.String,
  steps: Schema.mutable(Schema.Array(Step)),
  impact: Schema.optional(Schema.String),
  blockers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = { operationID: string; chainID: string; json: string; markdown: string; steps: number }

export const AttackChainTool = Tool.define<typeof Parameters, Metadata, never>(
  "attack_chain",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeAttackChain(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Attack chain ${result.chainID}`,
          output: [`operation_id: ${result.operationID}`, `chain_id: ${result.chainID}`, `json: ${result.json}`, `markdown: ${result.markdown}`, `steps: ${result.steps}`].join("\n"),
          metadata: result,
        }
      }),
  }),
)
