import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./tool_acquire.txt"
import { Instance } from "@/project/instance"
import { acquireManifestTools, acquireTool } from "@/ulm/tool-acquisition"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  toolID: Schema.optional(Schema.String),
  install: Schema.optional(Schema.Boolean),
  platform: Schema.optional(Schema.String),
  manifestPath: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  toolID?: string
  available: boolean
  installed?: boolean
  recordPath: string
}

export const ToolAcquireTool = Tool.define<typeof Parameters, Metadata, never>(
  "tool_acquire",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        if (!params.toolID) {
          const result = yield* Effect.tryPromise(() =>
            acquireManifestTools({
              worktree: Instance.worktree,
              operationID: params.operationID,
              install: params.install,
              platform: params.platform,
              manifestPath: params.manifestPath,
            }),
          ).pipe(Effect.orDie)
          return {
            title: result.blocked ? `Tool preflight: ${result.blocked} blocked` : "Tool preflight: ready",
            output: [
              `operation_id: ${result.operationID}`,
              `total: ${result.total}`,
              `available: ${result.available}`,
              `blocked: ${result.blocked}`,
              `installed: ${result.installed}`,
              `install_attempted: ${result.installAttempted}`,
              `summary: ${result.summaryPath}`,
              `markdown: ${result.markdownPath}`,
            ].join("\n"),
            metadata: {
              operationID: result.operationID,
              available: result.blocked === 0,
              recordPath: result.summaryPath,
            },
          }
        }
        const toolID = params.toolID
        const result = yield* Effect.tryPromise(() =>
          acquireTool({
            worktree: Instance.worktree,
            operationID: params.operationID,
            toolID,
            install: params.install,
            platform: params.platform,
            manifestPath: params.manifestPath,
          }),
        ).pipe(Effect.orDie)
        return {
          title: result.available ? `${result.toolID} available` : `${result.toolID} blocked`,
          output: [
            `operation_id: ${result.operationID}`,
            `tool_id: ${result.toolID}`,
            `available: ${result.available}`,
            `installed: ${result.installed}`,
            `record: ${result.recordPath}`,
            `validate: ${result.validationCommand}`,
            ...(result.installCommand ? [`install: ${result.installCommand}`] : []),
            ...(result.blocker ? [`blocker: ${result.blocker}`] : []),
            `fallbacks: ${result.fallbacks.join(", ") || "none"}`,
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            toolID: result.toolID,
            available: result.available,
            installed: result.installed,
            recordPath: result.recordPath,
          },
        }
      }),
  }),
)
