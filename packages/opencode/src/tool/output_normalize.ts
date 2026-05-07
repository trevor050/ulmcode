import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./output_normalize.txt"
import { Instance } from "@/project/instance"
import { normalizeToolOutput } from "@/ulm/operation-extras"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  tool: Schema.Literals(["nmap", "nuclei", "httpx", "ffuf", "gobuster", "nikto", "sqlmap", "subfinder", "generic"]),
  title: Schema.optional(Schema.String),
  content: Schema.String,
  sourcePath: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
  counts: { lines: number; interesting: number; hosts: number; urls: number; ports: number }
}

export const OutputNormalizeTool = Tool.define<typeof Parameters, Metadata, never>(
  "output_normalize",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => normalizeToolOutput(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Normalized ${params.tool} output`,
          output: [
            `operation_id: ${result.operationID}`,
            `json: ${result.json}`,
            `markdown: ${result.markdown}`,
            `lines: ${result.counts.lines}`,
            `interesting: ${result.counts.interesting}`,
            `hosts: ${result.counts.hosts}`,
            `urls: ${result.counts.urls}`,
            `ports: ${result.counts.ports}`,
          ].join("\n"),
          metadata: result,
        }
      }),
  }),
)
