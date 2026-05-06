import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_governor.txt"
import { Instance } from "@/project/instance"
import { evaluateRuntimeGovernor, formatGovernorDecision, writeRuntimeGovernorRouteAudit } from "@/ulm/runtime-governor"
import { buildModelRuntimeCatalog } from "@/ulm/model-runtime-catalog"
import { Provider } from "@/provider/provider"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  laneID: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  laneID?: string
  action: "continue" | "compact" | "stop"
  reason: string
  routeAuditPath?: string
}

export const OperationGovernorTool = Tool.define<typeof Parameters, Metadata, Provider.Service>(
  "operation_governor",
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const providers = yield* provider.list()
          const modelCatalog = buildModelRuntimeCatalog(providers)
          const routeAudit = yield* Effect.tryPromise(() =>
            writeRuntimeGovernorRouteAudit(Instance.worktree, {
              operationID: params.operationID,
              providers,
            }),
          ).pipe(Effect.orElseSucceed(() => undefined))
          const decision = yield* Effect.tryPromise(() =>
            evaluateRuntimeGovernor(Instance.worktree, { ...params, modelCatalog }),
          ).pipe(Effect.orDie)
          return {
            title: `Governor: ${decision.action}`,
            output: [
              formatGovernorDecision(decision),
              "",
              `model_route_audit: ${routeAudit?.json ?? "not written; operation graph is missing"}`,
            ].join("\n"),
            metadata: {
              operationID: decision.operationID,
              laneID: decision.laneID,
              action: decision.action,
              reason: decision.reason,
              routeAuditPath: routeAudit?.json,
            },
          }
        }),
    }
  }),
)
