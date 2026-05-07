import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_checkpoint.txt"
import { Instance } from "@/project/instance"
import { writeOperationCheckpoint } from "@/ulm/artifact"

const EvidenceRef = Schema.Struct({
  id: Schema.String,
  path: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
})

export const Parameters = Schema.Struct({
  operationID: Schema.optional(Schema.String).annotate({
    description: "Stable operation identifier. Defaults to a slug of the objective.",
  }),
  objective: Schema.String.annotate({ description: "Authorized objective for this operation" }),
  stage: Schema.Literals(["intake", "recon", "mapping", "validation", "reporting", "handoff"]),
  status: Schema.Literals(["planned", "running", "blocked", "paused", "complete"]),
  summary: Schema.String.annotate({ description: "Factual checkpoint summary" }),
  nextActions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  blockers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  riskLevel: Schema.optional(Schema.Literals(["low", "medium", "high", "critical"])),
  activeTasks: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  evidence: Schema.optional(Schema.mutable(Schema.Array(EvidenceRef))),
  notes: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  root: string
  stage: string
  status: string
}

export const OperationCheckpointTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_checkpoint",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const { root, record } = yield* Effect.tryPromise(() => writeOperationCheckpoint(Instance.worktree, params)).pipe(
          Effect.orDie,
        )
        return {
          title: `${record.operationID}: ${record.stage}/${record.status}`,
          output: [
            `operation_id: ${record.operationID}`,
            `root: ${root}`,
            `stage: ${record.stage}`,
            `status: ${record.status}`,
            "",
            record.summary,
          ].join("\n"),
          metadata: {
            operationID: record.operationID,
            root,
            stage: record.stage,
            status: record.status,
          },
        }
      }),
  }),
)
