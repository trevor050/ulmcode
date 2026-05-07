import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./identity_graph.txt"
import { Instance } from "@/project/instance"
import { writeIdentityGraph } from "@/ulm/artifact"

const Node = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["person", "account", "group", "role", "application", "data", "vendor", "device"]),
  label: Schema.String,
  source: Schema.optional(Schema.String),
})

const Edge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  relationship: Schema.String,
  evidence: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  confidence: Schema.optional(Schema.Literals(["low", "medium", "high"])),
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  nodes: Schema.mutable(Schema.Array(Node)),
  edges: Schema.mutable(Schema.Array(Edge)),
  notes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
}

export const IdentityGraphTool = Tool.define<typeof Parameters, Metadata, never>(
  "identity_graph",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeIdentityGraph(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Wrote identity graph with ${params.nodes.length} nodes and ${params.edges.length} edges`,
          output: [`operation_id: ${result.operationID}`, `json: ${result.json}`, `markdown: ${result.markdown}`].join("\n"),
          metadata: result,
        }
      }),
  }),
)
