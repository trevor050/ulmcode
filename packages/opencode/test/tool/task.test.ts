import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Option } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { TaskListTool } from "@/tool/task_list"
import { TaskStatusTool } from "@/tool/task_status"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Bus } from "@/bus"
import { BackgroundJob } from "@/background/job"
import { Storage } from "@/storage/storage"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionStatus.defaultLayer,
    Bus.layer,
    BackgroundJob.defaultLayer,
    Storage.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
    loop: (input) => Effect.succeed(reply({ sessionID: input.sessionID, parts: [] }, "looped")),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("tool.task", () => {
  it.instance(
    "description sorts subagents by name and is stable across calls",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const get = Effect.fnUntraced(function* () {
          const tools = yield* registry.tools({ ...ref, agent: build })
          return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
        })
        const first = yield* get()
        const second = yield* get()

        expect(first).toBe(second)

        const alpha = first.indexOf("- alpha: Alpha agent")
        const explore = first.indexOf("- explore:")
        const general = first.indexOf("- general:")
        const zebra = first.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      }),
    {
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "description hides denied subagents for the caller",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const description =
          (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

        expect(description).toContain("- alpha: Alpha agent")
        expect(description).not.toContain("- zebra: Zebra agent")
      }),
    {
      config: {
        permission: {
          task: {
            "*": "allow",
            zebra: "deny",
          },
        },
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance("execute resumes an existing task session from task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(child.id)
      expect(result.metadata.sessionId).toBe(child.id)
      expect(result.output).toContain(`task_id: ${child.id}`)
      expect(seen?.sessionID).toBe(child.id)
    }),
  )

  it.instance("execute asks by default and skips checks when bypassed", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const calls: unknown[] = []
      const promptOps = stubOps()

      const exec = (extra?: Record<string, any>) =>
        def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                calls.push(input)
              }),
          },
        )

      yield* exec()
      yield* exec({ bypassAgentCheck: true })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        permission: "task",
        patterns: ["general"],
        always: ["*"],
        metadata: {
          description: "inspect bug",
          subagent_type: "general",
        },
      })
    }),
  )

  it.instance("execute cancels child session when abort signal fires", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "cancelled"))),
        loop: (input) => Effect.succeed(reply({ sessionID: input.sessionID, parts: [] }, "looped")),
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      expect(yield* Effect.promise(() => cancelled.promise)).toBe(input.sessionID)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.instance("execute creates a child when task_id does not exist", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: "ses_missing",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
      expect(result.metadata.sessionId).not.toBe("ses_missing")
      expect(result.output).toContain(`task_id: ${result.metadata.sessionId}`)
      expect(seen?.sessionID).toBe(result.metadata.sessionId)
    }),
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "reviewer",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(chat.id)
        expect(child.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "allow",
          },
          {
            permission: "read",
            pattern: "*",
            action: "allow",
          },
        ])
        expect(seen?.tools).toEqual({
          todowrite: false,
          bash: false,
          read: false,
        })
      }),
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )

  it.instance("can launch a task in the background and poll it with task_status", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const task = yield* TaskTool
      const taskDef = yield* task.init()
      const status = yield* TaskStatusTool
      const statusDef = yield* status.init()
      const jobs = yield* BackgroundJob.Service
      const promptOps = stubOps({ text: "background complete" })
      const ctx = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const result = yield* taskDef.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        ctx,
      )
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain("state: running")

      const waited = yield* jobs.wait({ id: result.metadata.sessionId })
      expect(waited.info?.status).toBe("completed")

      const polled = yield* statusDef.execute({ task_id: result.metadata.sessionId }, ctx)
      expect(polled.output).toContain("state: completed")
      expect(polled.output).toContain("background complete")
    }),
  )

  it.instance("background job metadata survives BackgroundJob service reload", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const id = `tool_${crypto.randomUUID().replaceAll("-", "")}`
      yield* Effect.addFinalizer(() => storage.remove(["background_job", id]).pipe(Effect.ignore))

      const startAndComplete = Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        yield* jobs.start({
          id,
          type: "task",
          title: "persisted background task",
          run: Effect.succeed("persisted output"),
        })
        expect((yield* jobs.wait({ id })).info?.status).toBe("completed")
      }).pipe(Effect.provide(Layer.fresh(BackgroundJob.layer)))

      const reloadAndGet = Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        return yield* jobs.get(id)
      }).pipe(Effect.provide(Layer.fresh(BackgroundJob.layer)))

      yield* startAndComplete
      const reloaded = yield* reloadAndGet

      expect(reloaded?.id).toBe(id)
      expect(reloaded?.status).toBe("completed")
      expect(reloaded?.output).toBe("persisted output")
    }),
  )

  it.instance("task_status reads completed background metadata after BackgroundJob service reload", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const storage = yield* Storage.Service
      const task = yield* TaskTool
      const taskDef = yield* task.init()
      const promptOps = stubOps({ text: "persisted status output" })
      const ctx = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const result = yield* taskDef.execute(
        {
          description: "inspect persistence",
          prompt: "return persisted status output",
          subagent_type: "general",
          background: true,
        },
        ctx,
      )
      yield* Effect.addFinalizer(() =>
        storage.remove(["background_job", result.metadata.sessionId]).pipe(Effect.ignore),
      )

      const jobs = yield* BackgroundJob.Service
      expect((yield* jobs.wait({ id: result.metadata.sessionId })).info?.status).toBe("completed")

      const polledAfterReload = yield* Effect.gen(function* () {
        const status = yield* TaskStatusTool
        const statusDef = yield* status.init()
        return yield* statusDef.execute({ task_id: result.metadata.sessionId }, ctx)
      }).pipe(Effect.provide(Layer.fresh(BackgroundJob.layer)))

      expect(polledAfterReload.metadata.state).toBe("completed")
      expect(polledAfterReload.output).toContain("persisted status output")
    }),
  )

  it.instance("task_status marks orphaned running background jobs stale after BackgroundJob service reload", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const sessions = yield* Session.Service
      const storage = yield* Storage.Service
      const jobs = yield* BackgroundJob.Service
      const taskSession = yield* sessions.create({ parentID: chat.id, title: "orphaned background task" })
      yield* Effect.addFinalizer(() => storage.remove(["background_job", taskSession.id]).pipe(Effect.ignore))
      yield* jobs.start({
        id: taskSession.id,
        type: "task",
        title: "orphaned background task",
        metadata: {
          parentSessionID: chat.id,
          sessionID: taskSession.id,
          subagent: "validator",
        },
        run: Effect.never,
      })
      const ctx = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: {},
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const polledAfterReload = yield* Effect.gen(function* () {
        const status = yield* TaskStatusTool
        const statusDef = yield* status.init()
        const list = yield* TaskListTool
        const listDef = yield* list.init()
        const listed = yield* listDef.execute({ status: "stale" }, ctx)
        expect(listed.output).toContain(taskSession.id)
        return yield* statusDef.execute({ task_id: taskSession.id }, ctx)
      }).pipe(Effect.provide(Layer.fresh(BackgroundJob.layer)))

      expect(polledAfterReload.metadata.state).toBe("stale")
      expect(polledAfterReload.output).toContain("state: stale")
      expect(polledAfterReload.output).toContain("lost its running fiber")
    }),
  )

  it.instance("task_list enumerates persisted background jobs", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const storage = yield* Storage.Service
      const jobs = yield* BackgroundJob.Service
      const id = `tool_${crypto.randomUUID().replaceAll("-", "")}`
      yield* Effect.addFinalizer(() => storage.remove(["background_job", id]).pipe(Effect.ignore))
      yield* jobs.start({
        id,
        type: "task",
        title: "enumerable background task",
        run: Effect.succeed("listed output"),
      })
      expect((yield* jobs.wait({ id })).info?.status).toBe("completed")

      const tool = yield* TaskListTool
      const def = yield* tool.init()
      const listed = yield* def.execute(
        { status: "completed" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {},
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(listed.output).toContain(id)
      expect(listed.output).toContain("enumerable background task")
      expect(listed.metadata.count).toBeGreaterThanOrEqual(1)
    }),
  )

  it.instance("background job cancellation interrupts the running fiber", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const jobs = yield* BackgroundJob.Service
      const id = `tool_${crypto.randomUUID().replaceAll("-", "")}`
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => storage.remove(["background_job", id]).pipe(Effect.ignore))

      yield* jobs.start({
        id,
        type: "task",
        title: "cancellable background task",
        run: Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.as("unreachable"),
          Effect.ensuring(Deferred.succeed(interrupted, undefined)),
        ),
      })

      yield* Deferred.await(started).pipe(Effect.timeout("1 second"))
      const cancelled = yield* jobs.cancel(id)
      const signal = yield* Deferred.await(interrupted).pipe(Effect.timeoutOption("1 second"))

      expect(cancelled?.status).toBe("cancelled")
      expect(Option.isSome(signal)).toBe(true)
    }),
  )
})
