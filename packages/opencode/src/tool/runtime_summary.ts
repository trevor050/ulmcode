import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./runtime_summary.txt"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { BackgroundJob } from "@/background/job"
import { SessionID, type SessionID as SessionIDT } from "@/session/schema"
import type { MessageV2 } from "@/session/message-v2"
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

function collectChildMessages(session: Session.Interface, sessionID: SessionIDT): Effect.Effect<MessageV2.WithParts[]> {
  return Effect.gen(function* () {
    const children = yield* session.children(sessionID)
    const batches = yield* Effect.all(
      children.map((child) =>
        Effect.gen(function* () {
          const messages = yield* session.messages({ sessionID: child.id })
          const descendants = yield* collectChildMessages(session, child.id)
          return [...messages, ...descendants]
        }),
      ),
    )
    return batches.flat()
  })
}

function jobSessionID(job: BackgroundJob.Info): SessionIDT | undefined {
  const sessionID = job.metadata?.sessionID
  if (typeof sessionID !== "string" || !sessionID) return undefined
  try {
    return SessionID.make(sessionID)
  } catch {
    return undefined
  }
}

function collectBackgroundJobMessages(
  session: Session.Interface,
  jobs: BackgroundJob.Info[],
): Effect.Effect<MessageV2.WithParts[]> {
  return Effect.gen(function* () {
    const sessionIDs = Array.from(new Set(jobs.map(jobSessionID).filter((id): id is SessionIDT => id !== undefined)))
    const batches = yield* Effect.all(
      sessionIDs.map((sessionID) =>
        Effect.gen(function* () {
          const messages = yield* session.messages({ sessionID })
          const descendants = yield* collectChildMessages(session, sessionID)
          return [...messages, ...descendants]
        }).pipe(Effect.catch(() => Effect.succeed<MessageV2.WithParts[]>([]))),
      ),
    )
    return batches.flat()
  })
}

function uniqueMessages(messages: MessageV2.WithParts[]) {
  const seen = new Set<string>()
  const result: MessageV2.WithParts[] = []
  for (const message of messages) {
    const key = `${message.info.sessionID}:${message.info.id}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(message)
  }
  return result
}

function backgroundStatus(status: BackgroundJob.Status): Schema.Schema.Type<typeof BackgroundTask>["status"] {
  if (status === "error") return "failed"
  return status
}

function backgroundSummary(job: BackgroundJob.Info) {
  if (job.title) return job.title
  if (job.output) return job.output.split(/\r?\n/)[0]
  if (job.error) return job.error.split(/\r?\n/)[0]
  return undefined
}

function backgroundAgent(job: BackgroundJob.Info) {
  const subagent = job.metadata?.subagent
  if (typeof subagent === "string" && subagent) return subagent
  return undefined
}

function backgroundOperationID(job: BackgroundJob.Info) {
  const operationID = job.metadata?.operationID
  if (typeof operationID === "string" && operationID) return operationID
  return undefined
}

function relevantBackgroundJobs(operationID: string, jobs: BackgroundJob.Info[]) {
  const scoped = jobs.filter((job) => backgroundOperationID(job) === operationID)
  if (scoped.length) return scoped
  return jobs.filter((job) => {
    const jobOperationID = backgroundOperationID(job)
    return jobOperationID === undefined || jobOperationID === operationID
  })
}

export const RuntimeSummaryTool = Tool.define<typeof Parameters, Metadata, Session.Service | BackgroundJob.Service>(
  "runtime_summary",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const jobs = yield* BackgroundJob.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx) =>
        Effect.gen(function* () {
          const worktree = Instance.worktree
          const jobItems = yield* jobs.list()
          const backgroundJobItems = relevantBackgroundJobs(params.operationID, jobItems)
          const childMessages = yield* collectChildMessages(session, ctx.sessionID)
          const backgroundMessages = yield* collectBackgroundJobMessages(session, backgroundJobItems)
          const sessionMessages = uniqueMessages([...ctx.messages, ...childMessages, ...backgroundMessages])
          const backgroundTasks =
            params.backgroundTasks ??
            backgroundJobItems.map((job) => ({
              id: job.id,
              agent: backgroundAgent(job),
              status: backgroundStatus(job.status),
              summary: backgroundSummary(job),
            }))
          const result = yield* Effect.tryPromise(() =>
            writeRuntimeSummary(worktree, {
              ...params,
              backgroundTasks,
              sessionMessages: sessionMessages.map((message) => ({
                role: message.info.role,
                agent: message.info.agent,
                modelID: message.info.role === "assistant" ? message.info.modelID : message.info.model?.modelID,
                providerID: message.info.role === "assistant" ? message.info.providerID : message.info.model?.providerID,
                cost: message.info.role === "assistant" ? message.info.cost : undefined,
                tokens: message.info.role === "assistant" ? message.info.tokens : undefined,
                summary: message.info.role === "assistant" ? message.info.summary : undefined,
                parts: message.parts.map((part) => ({
                  type: part.type,
                  auto: part.type === "compaction" ? part.auto : undefined,
                  overflow: part.type === "compaction" ? part.overflow : undefined,
                })),
              })),
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
        }).pipe(Effect.orDie)
    }
  }),
)
