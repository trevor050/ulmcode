import { InstanceState } from "@/effect/instance-state"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { Cause, Context, Deferred, Effect, Fiber, Layer, Scope } from "effect"

export type Status = "running" | "completed" | "error" | "cancelled" | "stale"

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  startedAt: number
  completedAt?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  fiber?: Fiber.Fiber<void, unknown>
}

type State = {
  jobs: Map<string, Active>
  scope: Scope.Scope
}

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  run: Effect.Effect<string, unknown>
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly updateMetadata: (id: string, metadata: Record<string, unknown>) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BackgroundJob") {}

const STORAGE_PREFIX = ["background_job"] as const

function snapshot(job: Active): Info {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

function orphaned(info: Info): Info {
  if (info.status !== "running") return info
  return {
    ...info,
    status: "stale",
    error: info.error ?? "Task was persisted as running, but the process lost its running fiber.",
    ...(info.metadata ? { metadata: { ...info.metadata } } : {}),
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("BackgroundJob.state")(function* () {
        return {
          jobs: new Map(),
          scope: yield* Scope.Scope,
        }
      }),
    )
    const storage = yield* Storage.Service

    const persist = Effect.fn("BackgroundJob.persist")(function* (info: Info) {
      yield* storage.write([...STORAGE_PREFIX, info.id], info).pipe(Effect.ignore)
    })

    const getPersisted = Effect.fn("BackgroundJob.getPersisted")(function* (id: string) {
      return yield* storage.read<Info>([...STORAGE_PREFIX, id]).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })

    const listPersisted = Effect.fn("BackgroundJob.listPersisted")(function* () {
      const keys = yield* storage.list([...STORAGE_PREFIX]).pipe(Effect.catch(() => Effect.succeed<string[][]>([])))
      const jobs = yield* Effect.all(
        keys.map((key) => storage.read<Info>(key).pipe(Effect.catch(() => Effect.succeed(undefined)))),
      )
      return jobs.filter((job): job is Info => job !== undefined)
    })

    const finish = Effect.fn("BackgroundJob.finish")(function* (
      job: Active,
      status: Exclude<Status, "running" | "stale">,
      data?: { output?: string; error?: string },
    ) {
      if (job.info.status !== "running") return snapshot(job)
      job.info.status = status
      job.info.completedAt = Date.now()
      if (data?.output !== undefined) job.info.output = data.output
      if (data?.error !== undefined) job.info.error = data.error
      job.fiber = undefined
      const info = snapshot(job)
      yield* persist(info)
      yield* Deferred.succeed(job.done, info).pipe(Effect.ignore)
      return info
    })

    const list: Interface["list"] = Effect.fn("BackgroundJob.list")(function* () {
      const items = new Map<string, Info>()
      const current = yield* InstanceState.get(state)
      for (const job of yield* listPersisted()) {
        items.set(job.id, current.jobs.has(job.id) ? job : orphaned(job))
      }
      for (const job of current.jobs.values()) items.set(job.info.id, snapshot(job))
      return Array.from(items.values())
        .toSorted((a, b) => a.startedAt - b.startedAt)
    })

    const get: Interface["get"] = Effect.fn("BackgroundJob.get")(function* (id) {
      const job = (yield* InstanceState.get(state)).jobs.get(id)
      if (!job) {
        const persisted = yield* getPersisted(id)
        return persisted ? orphaned(persisted) : undefined
      }
      return snapshot(job)
    })

    const updateMetadata: Interface["updateMetadata"] = Effect.fn("BackgroundJob.updateMetadata")(function* (id, metadata) {
      const job = (yield* InstanceState.get(state)).jobs.get(id)
      if (job) {
        job.info.metadata = {
          ...(job.info.metadata ?? {}),
          ...metadata,
        }
        const info = snapshot(job)
        yield* persist(info)
        return info
      }
      const persisted = yield* getPersisted(id)
      if (!persisted) return
      const info = {
        ...persisted,
        metadata: {
          ...(persisted.metadata ?? {}),
          ...metadata,
        },
      }
      yield* persist(info)
      return orphaned(info)
    })

    const start: Interface["start"] = Effect.fn("BackgroundJob.start")(function* (input) {
      const s = yield* InstanceState.get(state)
      const id = input.id ?? Identifier.ascending("tool")
      const existing = s.jobs.get(id)
      if (existing?.info.status === "running") return snapshot(existing)

      const job: Active = {
        info: {
          id,
          type: input.type,
          title: input.title,
          status: "running",
          startedAt: Date.now(),
          metadata: input.metadata,
        },
        done: yield* Deferred.make<Info>(),
      }
      s.jobs.set(id, job)
      yield* persist(snapshot(job))
      job.fiber = yield* input.run.pipe(
        Effect.matchCauseEffect({
          onSuccess: (output) => finish(job, "completed", { output }),
          onFailure: (cause) =>
            finish(job, Cause.hasInterruptsOnly(cause) ? "cancelled" : "error", {
              error: errorText(Cause.squash(cause)),
            }),
        }),
        Effect.asVoid,
        Effect.forkIn(s.scope),
      )
      return snapshot(job)
    })

    const wait: Interface["wait"] = Effect.fn("BackgroundJob.wait")(function* (input) {
      const job = (yield* InstanceState.get(state)).jobs.get(input.id)
      if (!job) {
        const persisted = yield* getPersisted(input.id)
        return { info: persisted ? orphaned(persisted) : undefined, timedOut: false }
      }
      if (job.info.status !== "running") return { info: yield* Deferred.await(job.done), timedOut: false }
      if (!input.timeout) return { info: yield* Deferred.await(job.done), timedOut: false }
      return yield* Effect.raceAll([
        Deferred.await(job.done).pipe(Effect.map((info) => ({ info, timedOut: false }))),
        Effect.sleep(input.timeout).pipe(Effect.as({ info: snapshot(job), timedOut: true })),
      ])
    })

    const cancel: Interface["cancel"] = Effect.fn("BackgroundJob.cancel")(function* (id) {
      const job = (yield* InstanceState.get(state)).jobs.get(id)
      if (!job) return
      if (job.info.status !== "running") return snapshot(job)
      const fiber = job.fiber
      const info = yield* finish(job, "cancelled")
      if (fiber) yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
      return info
    })

    return Service.of({ list, get, updateMetadata, start, wait, cancel })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Storage.defaultLayer))

export * as BackgroundJob from "./job"
