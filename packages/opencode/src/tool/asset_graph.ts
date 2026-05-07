import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./asset_graph.txt"
import { Instance } from "@/project/instance"
import { writeAssetGraph } from "@/ulm/operation-extras"

const Node = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["target", "host", "service", "route", "api", "form", "parameter", "account", "role", "data", "finding", "evidence", "browser_state", "other"]),
  label: Schema.String,
  source: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
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
  edges: Schema.optional(Schema.mutable(Schema.Array(Edge))),
  notes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = { operationID: string; json: string; markdown: string; nodes: number; edges: number }

export const AssetGraphTool = Tool.define<typeof Parameters, Metadata, never>(
  "asset_graph",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeAssetGraph(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Asset graph: ${result.nodes} nodes, ${result.edges} edges`,
          output: [`operation_id: ${result.operationID}`, `json: ${result.json}`, `markdown: ${result.markdown}`, `nodes: ${result.nodes}`, `edges: ${result.edges}`].join("\n"),
          metadata: result,
        }
      }),
  }),
)
