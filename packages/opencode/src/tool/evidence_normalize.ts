import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./evidence_normalize.txt"
import { Instance } from "@/project/instance"
import { formatEvidenceNormalization, normalizeEvidence } from "@/ulm/evidence-normalizer"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  artifactPaths: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  commandPlanPaths: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  parser: Schema.optional(Schema.Literals(["auto", "httpx-jsonl", "dnsx-jsonl", "ffuf-json", "zap-json", "nmap-xml", "text"])),
  writeEvidenceRecords: Schema.optional(Schema.Boolean),
})

type Metadata = {
  operationID: string
  indexPath: string
  leadsPath: string
  artifacts: number
  evidence: number
  leads: number
}

export const EvidenceNormalizeTool = Tool.define<typeof Parameters, Metadata, never>(
  "evidence_normalize",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => normalizeEvidence(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Normalized ${result.leads.length} evidence leads`,
          output: formatEvidenceNormalization(result),
          metadata: {
            operationID: result.operationID,
            indexPath: result.indexPath,
            leadsPath: result.leadsPath,
            artifacts: result.artifacts.length,
            evidence: result.evidence.length,
            leads: result.leads.length,
          },
        }
      }),
  }),
)
