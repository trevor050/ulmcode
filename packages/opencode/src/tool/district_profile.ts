import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./district_profile.txt"
import { Instance } from "@/project/instance"
import { writeDistrictProfile } from "@/ulm/artifact"

const NamedItem = Schema.Struct({
  name: Schema.String,
  source: Schema.String,
  notes: Schema.optional(Schema.String),
})

const SystemItem = Schema.Struct({
  name: Schema.String,
  category: Schema.String,
  source: Schema.String,
  notes: Schema.optional(Schema.String),
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  name: Schema.String,
  domains: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  systems: Schema.optional(Schema.mutable(Schema.Array(SystemItem))),
  departments: Schema.optional(Schema.mutable(Schema.Array(NamedItem))),
  notes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
}

export const DistrictProfileTool = Tool.define<typeof Parameters, Metadata, never>(
  "district_profile",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeDistrictProfile(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Wrote district profile for ${params.name}`,
          output: [`operation_id: ${result.operationID}`, `json: ${result.json}`, `markdown: ${result.markdown}`].join("\n"),
          metadata: result,
        }
      }),
  }),
)
