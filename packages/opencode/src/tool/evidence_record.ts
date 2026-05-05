import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./evidence_record.txt"
import { Instance } from "@/project/instance"
import { writeEvidence } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  evidenceID: Schema.optional(Schema.String),
  title: Schema.String,
  kind: Schema.Literals(["command_output", "http_response", "screenshot", "file", "note", "log"]),
  summary: Schema.String,
  source: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  evidenceID: string
  json: string
  rawPath?: string
}

export const EvidenceRecordTool = Tool.define<typeof Parameters, Metadata, never>(
  "evidence_record",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeEvidence(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Recorded evidence ${result.evidenceID}`,
          output: [
            `operation_id: ${result.operationID}`,
            `evidence_id: ${result.evidenceID}`,
            `json: ${result.json}`,
            ...(result.rawPath ? [`raw: ${result.rawPath}`] : []),
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            evidenceID: result.evidenceID,
            json: result.json,
            rawPath: result.rawPath,
          },
        }
      }),
  }),
)
