import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./finding_record.txt"
import { Instance } from "@/project/instance"
import { writeFinding } from "@/ulm/artifact"

const EvidenceRef = Schema.Struct({
  id: Schema.String,
  path: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  findingID: Schema.optional(Schema.String),
  title: Schema.String,
  state: Schema.Literals(["candidate", "needs_validation", "validated", "report_ready", "rejected"]),
  severity: Schema.Literals(["info", "low", "medium", "high", "critical"]),
  confidence: Schema.Number,
  affectedAssets: Schema.mutable(Schema.Array(Schema.String)),
  evidence: Schema.mutable(Schema.Array(EvidenceRef)),
  description: Schema.String,
  impact: Schema.optional(Schema.String),
  remediation: Schema.optional(Schema.String),
  sourceTasks: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = {
  operationID: string
  findingID: string
  state: string
  severity: string
  root: string
}

export const FindingRecordTool = Tool.define<typeof Parameters, Metadata, never>(
  "finding_record",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const { root, record } = yield* Effect.tryPromise(() => writeFinding(Instance.worktree, params)).pipe(
          Effect.orDie,
        )
        return {
          title: `${record.severity}: ${record.title}`,
          output: [
            `operation_id: ${record.operationID}`,
            `finding_id: ${record.findingID}`,
            `state: ${record.state}`,
            `severity: ${record.severity}`,
            `root: ${root}`,
          ].join("\n"),
          metadata: {
            operationID: record.operationID,
            findingID: record.findingID,
            state: record.state,
            severity: record.severity,
            root,
          },
        }
      }),
  }),
)
