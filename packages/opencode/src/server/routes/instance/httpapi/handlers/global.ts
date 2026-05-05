import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { Bus } from "@/bus"
import { Installation } from "@/installation"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { RootHttpApi } from "../api"
import { GlobalUpgradeInput } from "../groups/global"
import { globalEventReplay } from "@/server/global-event-replay"
import { parseLastEventId, type StoredEvent } from "@/server/sse-replay"

const log = Log.create({ service: "server" })

type QueueItem = { id?: number; data: string }

function eventData(item: QueueItem): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: item.id === undefined ? undefined : String(item.id),
    data: item.data,
  }
}

function parseBody(body: string) {
  try {
    return JSON.parse(body || "{}") as unknown
  } catch {
    return undefined
  }
}

function queueItem(data: unknown): QueueItem {
  return { data: JSON.stringify(data) }
}

function eventResponse(request: HttpServerRequest.HttpServerRequest) {
  log.info("global event connected")
  const replayFrom = parseLastEventId(request.headers["last-event-id"] ?? request.headers["Last-Event-ID"])
  const events = Stream.callback<QueueItem>((queue) => {
    let replaying = true
    const pending: StoredEvent[] = []
    let lastQueuedId = 0
    const offerStoredEvent = (event: StoredEvent) => {
      if (event.id <= lastQueuedId) return
      lastQueuedId = event.id
      Queue.offerUnsafe(queue, event)
    }
    const handler = (event: StoredEvent) => {
      if (replaying) pending.push(event)
      else offerStoredEvent(event)
    }
    return Effect.acquireRelease(
      Effect.sync(() => {
        const unsubscribe = globalEventReplay.subscribe(handler)
        const heartbeat = setInterval(() => {
          Queue.offerUnsafe(
            queue,
            queueItem({ payload: { id: Bus.createID(), type: "server.heartbeat", properties: {} } }),
          )
        }, 10_000)
        Queue.offerUnsafe(queue, queueItem({ payload: { id: Bus.createID(), type: "server.connected", properties: {} } }))
        const missed = globalEventReplay.eventsAfter(replayFrom)
        if (missed.length > 0) log.info("global event replay", { lastEventId: replayFrom, replayed: missed.length })
        for (const event of missed) offerStoredEvent(event)
        replaying = false
        for (const event of pending) offerStoredEvent(event)
        return () => {
          clearInterval(heartbeat)
          unsubscribe()
        }
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    )
  })

  return HttpServerResponse.stream(
    events.pipe(
      Stream.map(eventData),
      Stream.pipeThroughChannel(Sse.encode()),
      Stream.encodeText,
      Stream.ensuring(Effect.sync(() => log.info("global event disconnected"))),
    ),
    {
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    },
  )
}

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const installation = yield* Installation.Service
    const bridge = yield* EffectBridge.make()

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      return { healthy: true as const, version: InstallationVersion }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      return eventResponse(ctx.request)
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      const result = yield* config.updateGlobal(ctx.payload)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return result.info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return {
          status: 400,
          body: { success: false as const, error: "Unknown installation method" },
        }
      }
      const target = ctx.payload.target || (yield* installation.latest(method))
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ status: 200, body: { success: true as const, version: target } }),
        Effect.catch((err) =>
          Effect.succeed({
            status: 500,
            body: {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            },
          }),
        ),
      )
      if (!result.body.success) return result
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return result
    })

    const upgradeRaw = Effect.fn("GlobalHttpApi.upgradeRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const json = parseBody(body)
      if (json === undefined) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const payload = yield* Schema.decodeUnknownEffect(GlobalUpgradeInput)(json).pipe(
        Effect.map((payload) => ({ valid: true as const, payload })),
        Effect.catch(() => Effect.succeed({ valid: false as const })),
      )
      if (!payload.valid) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const result = yield* upgrade({ payload: payload.payload })
      return HttpServerResponse.jsonUnsafe(result.body, { status: result.status })
    })

    return handlers
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("dispose", dispose)
      .handleRaw("upgrade", upgradeRaw)
  }),
)
