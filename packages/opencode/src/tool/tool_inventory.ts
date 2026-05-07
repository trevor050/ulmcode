import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./tool_inventory.txt"
import { Instance } from "@/project/instance"
import { collectToolInventory } from "@/ulm/tool-inventory"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  includeVersions: Schema.optional(Schema.Boolean),
  probeTimeoutMs: Schema.optional(Schema.Number),
  writeArtifacts: Schema.optional(Schema.Boolean),
})

type Metadata = {
  operationID: string
  installed: number
  missing: number
  highValueMissing: number
  json?: string
  markdown?: string
}

export const ToolInventoryTool = Tool.define<typeof Parameters, Metadata, never>(
  "tool_inventory",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => collectToolInventory(Instance.worktree, params)).pipe(Effect.orDie)
        const missingHighValue = result.record.tools.filter((tool) => !tool.installed && tool.highValue).map((tool) => tool.id)
        return {
          title: `Tool inventory: ${result.record.counts.installed} installed, ${result.record.counts.missing} missing`,
          output: [
            `operation_id: ${result.operationID}`,
            `installed: ${result.record.counts.installed}`,
            `missing: ${result.record.counts.missing}`,
            `high_value_missing: ${missingHighValue.join(", ") || "none"}`,
            `seclists: ${result.record.seclists.found ? result.record.seclists.paths.join(", ") : "missing"}`,
            ...(result.json ? [`json: ${result.json}`] : []),
            ...(result.markdown ? [`markdown: ${result.markdown}`] : []),
            "",
            "next_actions:",
            ...result.record.nextActions.map((action) => `- ${action}`),
            "<tool_inventory_json>",
            JSON.stringify(result.record, null, 2),
            "</tool_inventory_json>",
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            installed: result.record.counts.installed,
            missing: result.record.counts.missing,
            highValueMissing: result.record.counts.highValueMissing,
            json: result.json,
            markdown: result.markdown,
          },
        }
      }),
  }),
)
