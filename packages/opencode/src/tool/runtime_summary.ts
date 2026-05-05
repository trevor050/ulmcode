import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./runtime_summary.txt"
import { Instance } from "@/project/instance"
import { writeRuntimeSummary } from "@/ulm/artifact"

const ModelCalls = Schema.Struct({
  total: Schema.optional(Schema.Number),
  byModel: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
})

const AgentUsage = Schema.Struct({
  calls: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  costUSD: Schema.optional(Schema.Number),
})

const Usage = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  reasoningTokens: Schema.optional(Schema.Number),
  cacheReadTokens: Schema.optional(Schema.Number),
  cacheWriteTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  costUSD: Schema.optional(Schema.Number),
  budgetUSD: Schema.optional(Schema.Number),
  remainingUSD: Schema.optional(Schema.Number),
  byAgent: Schema.optional(Schema.Record(Schema.String, AgentUsage)),
})

const Compaction = Schema.Struct({
  count: Schema.optional(Schema.Number),
  pressure: Schema.optional(Schema.Literals(["low", "moderate", "high", "critical"])),
  lastSummary: Schema.optional(Schema.String),
})

const Fetches = Schema.Struct({
  total: Schema.optional(Schema.Number),
  repeatedTargets: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

const BackgroundTask = Schema.Struct({
  id: Schema.String,
  agent: Schema.optional(Schema.String),
  status: Schema.Literals(["running", "completed", "failed", "cancelled", "stale", "unknown"]),
  summary: Schema.optional(Schema.String),
})

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  modelCalls: Schema.optional(ModelCalls),
  usage: Schema.optional(Usage),
  compaction: Schema.optional(Compaction),
  fetches: Schema.optional(Fetches),
  backgroundTasks: Schema.optional(Schema.mutable(Schema.Array(BackgroundTask))),
  notes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
  finalDir: string
}

export const RuntimeSummaryTool = Tool.define<typeof Parameters, Metadata, never>(
  "runtime_summary",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx) =>
      Effect.gen(function* () {
        const worktree = Instance.worktree
        const result = yield* Effect.tryPromise(() =>
          writeRuntimeSummary(worktree, {
            ...params,
            sessionMessages: ctx.messages.map((message) => message.info),
          }),
        ).pipe(Effect.orDie)
        return {
          title: "Wrote ULMCode runtime summary",
          output: [
            `operation_id: ${result.operationID}`,
            `json: ${result.json}`,
            `markdown: ${result.markdown}`,
            `deliverables: ${result.finalDir}`,
          ].join("\n"),
          metadata: result,
        }
      }),
  }),
)
