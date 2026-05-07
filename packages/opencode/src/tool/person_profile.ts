import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./person_profile.txt"
import { Instance } from "@/project/instance"
import { writePersonProfile } from "@/ulm/artifact"

const PublicContact = Schema.Struct({
  type: Schema.Literals(["email", "phone", "office", "other"]),
  value: Schema.String,
  source: Schema.String,
})

const Source = Schema.Struct({
  title: Schema.String,
  url: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  summary: Schema.String,
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  name: Schema.String,
  role: Schema.String,
  organization: Schema.optional(Schema.String),
  roleCategory: Schema.Literals([
    "district_leadership",
    "school_leadership",
    "technology",
    "student_services",
    "finance_hr",
    "teacher_staff",
    "vendor_partner",
    "other",
  ]),
  whyTheyMatter: Schema.String,
  likelyAccess: Schema.mutable(Schema.Array(Schema.String)),
  publicContacts: Schema.optional(Schema.mutable(Schema.Array(PublicContact))),
  sources: Schema.mutable(Schema.Array(Source)),
  validationIdeas: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  excludedPrivateInfo: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
}

export const PersonProfileTool = Tool.define<typeof Parameters, Metadata, never>(
  "person_profile",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writePersonProfile(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Wrote person profile for ${params.name}`,
          output: [`operation_id: ${result.operationID}`, `json: ${result.json}`, `markdown: ${result.markdown}`].join("\n"),
          metadata: result,
        }
      }),
  }),
)
