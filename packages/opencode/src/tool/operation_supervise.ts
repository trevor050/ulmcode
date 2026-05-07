import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_supervise.txt"
import { Instance } from "@/project/instance"
import { superviseOperation } from "@/ulm/operation-supervisor"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  reviewKind: Schema.optional(
    Schema.Literals([
      "startup",
      "heartbeat",
      "pre_compaction",
      "post_compaction",
      "pre_handoff",
      "turn_end",
      "reporting_gate",
      "operator_timeout",
      "manual",
    ]),
  ),
  maxActions: Schema.optional(Schema.Number),
  writeArtifacts: Schema.optional(Schema.Boolean),
  latestAssistantMessage: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  reviewKind: string
  actions: string[]
  nextTools: string[]
  files?: {
    json: string
    markdown: string
  }
}

export const OperationSuperviseTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_supervise",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => superviseOperation(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Supervisor ${result.operationID}: ${result.decisions.map((item) => item.action).join(", ")}`,
          output: [
            `operation_id: ${result.operationID}`,
            `review_kind: ${result.reviewKind}`,
            `decisions: ${result.decisions.length}`,
            ...(result.files ? [`json: ${result.files.json}`, `markdown: ${result.files.markdown}`] : []),
            "",
            ...result.decisions.map((item) =>
              [
                `- action: ${item.action}`,
                `  reason: ${item.reason}`,
                item.requiredNextTool ? `  next_tool: ${item.requiredNextTool}` : undefined,
                `  operator: ${item.operatorMessage}`,
                `  model: ${item.modelPrompt}`,
              ]
                .filter((line): line is string => line !== undefined)
                .join("\n"),
            ),
            "<operation_supervise_json>",
            JSON.stringify(result, null, 2),
            "</operation_supervise_json>",
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            reviewKind: result.reviewKind,
            actions: result.decisions.map((item) => item.action),
            nextTools: [...new Set(result.decisions.map((item) => item.requiredNextTool).filter((item): item is string => item !== undefined))],
            files: result.files,
          },
        }
      }),
  }),
)
