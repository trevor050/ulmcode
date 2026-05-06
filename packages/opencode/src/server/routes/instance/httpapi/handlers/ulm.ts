import * as InstanceState from "@/effect/instance-state"
import {
  buildOperationAudit,
  buildOperationResumeBrief,
  listOperationStatuses,
  readOperationStatus,
} from "@/ulm/artifact"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type { UlmAuditQuery, UlmListQuery, UlmOperationQuery, UlmResumeQuery } from "../groups/ulm"

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export const ulmHandlers = HttpApiBuilder.group(InstanceHttpApi, "ulm", (handlers) =>
  Effect.gen(function* () {
    const worktree = Effect.map(InstanceState.context, (ctx) => ctx.worktree)

    const list = Effect.fn("UlmHttpApi.list")(function* (ctx: { query: typeof UlmListQuery.Type }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          listOperationStatuses(root, {
            eventLimit: ctx.query.eventLimit,
          }),
        catch: (error) => new Error(`Unable to list ULM operations: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const status = Effect.fn("UlmHttpApi.status")(function* (ctx: {
      params: { operationID: string }
      query: typeof UlmOperationQuery.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          readOperationStatus(root, ctx.params.operationID, {
            eventLimit: ctx.query.eventLimit,
          }),
        catch: (error) => new Error(`Unable to read ULM operation status: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const resume = Effect.fn("UlmHttpApi.resume")(function* (ctx: {
      params: { operationID: string }
      query: typeof UlmResumeQuery.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          buildOperationResumeBrief(root, ctx.params.operationID, {
            eventLimit: ctx.query.eventLimit,
            staleAfterMinutes: ctx.query.staleAfterMinutes,
          }),
        catch: (error) => new Error(`Unable to build ULM resume brief: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const audit = Effect.fn("UlmHttpApi.audit")(function* (ctx: {
      params: { operationID: string }
      query: typeof UlmAuditQuery.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          buildOperationAudit(root, ctx.params.operationID, {
            eventLimit: ctx.query.eventLimit,
            staleAfterMinutes: ctx.query.staleAfterMinutes,
            minWords: ctx.query.minWords,
            requireOutlineBudget: ctx.query.requireOutlineBudget,
            minOutlineWordsPerPage: ctx.query.minOutlineWordsPerPage,
            requireFindingSections: ctx.query.requireFindingSections,
            minFindingWords: ctx.query.minFindingWords,
            finalHandoff: ctx.query.finalHandoff,
          }),
        catch: (error) => new Error(`Unable to audit ULM operation: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    return handlers.handle("list", list).handle("status", status).handle("resume", resume).handle("audit", audit)
  }),
)
