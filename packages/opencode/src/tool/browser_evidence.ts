import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./browser_evidence.txt"
import { Instance } from "@/project/instance"
import { writeBrowserEvidence } from "@/ulm/operation-extras"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  evidenceID: Schema.optional(Schema.String),
  title: Schema.String,
  url: Schema.String,
  authState: Schema.optional(Schema.Literals(["unknown", "unauthenticated", "authenticated", "privileged", "student", "teacher", "admin"])),
  screenshotPath: Schema.optional(Schema.String),
  domSnapshotPath: Schema.optional(Schema.String),
  tracePath: Schema.optional(Schema.String),
  requestLogPath: Schema.optional(Schema.String),
  summary: Schema.String,
  notes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = { operationID: string; evidenceID: string; json: string; markdown: string }

export const BrowserEvidenceTool = Tool.define<typeof Parameters, Metadata, never>(
  "browser_evidence",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeBrowserEvidence(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Browser evidence ${result.evidenceID}`,
          output: [`operation_id: ${result.operationID}`, `evidence_id: ${result.evidenceID}`, `json: ${result.json}`, `markdown: ${result.markdown}`].join("\n"),
          metadata: result,
        }
      }),
  }),
)
