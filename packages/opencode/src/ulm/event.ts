import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"

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
        Schema.Literal("stage_gate"),
        Schema.Literal("operation_audit"),
      ]),
      path: Schema.optional(Schema.String),
    }),
  ),
}
