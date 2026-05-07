import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_template.txt"
import { Instance } from "@/project/instance"
import { createOperationFromTemplate } from "@/ulm/operation-extras"

export const Parameters = Schema.Struct({
  operationID: Schema.optional(Schema.String),
  template: Schema.Literals([
    "single-url-web",
    "external-k12-district",
    "authenticated-webapp",
    "internal-network",
    "cloud-posture",
    "code-audit",
    "report-only",
    "benchmark-suite",
  ]),
  objective: Schema.String,
  targetDurationHours: Schema.optional(Schema.Number),
  trustLevel: Schema.optional(Schema.Literals(["guided", "moderate", "unattended", "lab_full"])),
  scanProfile: Schema.optional(Schema.Literals(["paranoid", "stealth", "balanced", "aggressive", "lab-insane"])),
  budgetUSD: Schema.optional(Schema.Number),
})

type Metadata = {
  operationID: string
  goal: string
  plan: string
  graph: string
  outline: string
  memory: string
}

export const OperationTemplateTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_template",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => createOperationFromTemplate(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Created ${params.template} operation ${result.operationID}`,
          output: [
            `operation_id: ${result.operationID}`,
            `template: ${params.template}`,
            `goal: ${result.goal.files.json}`,
            `plan: ${result.plan.json}`,
            `graph: ${result.graph.json}`,
            `outline: ${result.outline.file}`,
            `memory: ${result.memory}`,
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            goal: result.goal.files.json,
            plan: result.plan.json,
            graph: result.graph.json,
            outline: result.outline.file,
            memory: result.memory,
          },
        }
      }),
  }),
)
