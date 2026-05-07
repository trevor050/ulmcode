import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"

const OperationBrief = Schema.Struct({
  objective: Schema.optional(Schema.String),
  stage: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  riskLevel: Schema.optional(Schema.String),
  nextActions: Schema.optional(Schema.Array(Schema.String)),
  blockers: Schema.optional(Schema.Array(Schema.String)),
})

const CountBrief = Schema.Struct({
  total: Schema.Finite,
})

export const OperationEvent = {
  Updated: BusEvent.define(
    "operation.updated",
    Schema.Struct({
      operationID: Schema.String,
      artifact: Schema.Union([
        Schema.Literal("checkpoint"),
        Schema.Literal("operation_plan"),
        Schema.Literal("evidence"),
        Schema.Literal("finding"),
        Schema.Literal("report_outline"),
        Schema.Literal("report_render"),
        Schema.Literal("runtime_summary"),
        Schema.Literal("eval_scorecard"),
        Schema.Literal("stage_gate"),
        Schema.Literal("operation_audit"),
      ]),
      path: Schema.optional(Schema.String),
      operation: Schema.optional(OperationBrief),
      findings: Schema.optional(CountBrief),
      evidence: Schema.optional(CountBrief),
      reports: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
      runtimeSummary: Schema.optional(Schema.Boolean),
    }),
  ),
}
