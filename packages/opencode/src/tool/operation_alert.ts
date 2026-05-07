import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_alert.txt"
import { Instance } from "@/project/instance"
import { writeOperationAlert } from "@/ulm/operation-extras"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  alertID: Schema.optional(Schema.String),
  kind: Schema.Literals(["validated_high", "validated_critical", "daemon_stale", "budget_exhausted", "handoff_ready", "blocked", "custom"]),
  severity: Schema.optional(Schema.Literals(["info", "warning", "high", "critical"])),
  title: Schema.String,
  message: Schema.String,
  sinks: Schema.optional(Schema.mutable(Schema.Array(Schema.Literals(["webhook", "discord", "slack", "email", "console"])))),
  nextActions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = { operationID: string; alertID: string; json: string; markdown: string; sinks: number }

export const OperationAlertTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_alert",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => writeOperationAlert(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Operation alert ${result.alertID}`,
          output: [`operation_id: ${result.operationID}`, `alert_id: ${result.alertID}`, `json: ${result.json}`, `markdown: ${result.markdown}`, `sinks: ${result.sinks}`].join("\n"),
          metadata: result,
        }
      }),
  }),
)
