import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import { RuntimeSummaryTool } from "@/tool/runtime_summary"
import { Truncate } from "@/tool/truncate"
import { Storage } from "@/storage/storage"
import { BackgroundJob } from "@/background/job"
import { writeOperationCheckpoint } from "@/ulm/artifact"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "@/project/instance"
import { MessageID } from "@/session/schema"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  Bus.layer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  Storage.defaultLayer,
  BackgroundJob.defaultLayer,
  Truncate.defaultLayer,
)

describe("tool.runtime_summary", () => {
  test("derives usage from the current tool context messages", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const worktree = Instance.worktree
            yield* Effect.promise(() =>
              writeOperationCheckpoint(worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "validation",
                status: "running",
                summary: "Validation is still running.",
              }),
            )

            const tool = yield* RuntimeSummaryTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "school",
              },
              {
                sessionID: "session-1" as any,
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [
                  {
                    info: {
                      role: "assistant",
                      agent: "pentest",
                      modelID: "gpt-5.5",
                      providerID: "openai",
                      cost: 0.5,
                      tokens: {
                        input: 1000,
                        output: 400,
                        reasoning: 100,
                        cache: { read: 50, write: 0 },
                      },
                    },
                    parts: [],
                  },
                ] as any,
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))
            expect(record.modelCalls.total).toBe(1)
            expect(record.modelCalls.byModel["gpt-5.5"]).toBe(1)
            expect(record.usage.totalTokens).toBe(1500)
            expect(record.usage.byAgent.pentest.costUSD).toBe(0.5)
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("includes child subagent session usage by default", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const worktree = Instance.worktree
            yield* Effect.promise(() =>
              writeOperationCheckpoint(worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "validation",
                status: "running",
                summary: "Validation is still running.",
              }),
            )

            const sessions = yield* Session.Service
            const parent = yield* sessions.create({ title: "parent" })
            const child = yield* sessions.create({ parentID: parent.id, title: "child recon" })
            yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "assistant",
              parentID: MessageID.ascending(),
              sessionID: child.id,
              mode: "recon",
              agent: "recon",
              cost: 0.25,
              path: { cwd: worktree, root: worktree },
              tokens: {
                input: 500,
                output: 300,
                reasoning: 200,
                cache: { read: 0, write: 0 },
              },
              modelID: "gpt-5.4-mini",
              providerID: "openai",
              time: { created: Date.now(), completed: Date.now() },
            } as any)
            const compaction = yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: child.id,
              agent: "recon",
              model: { providerID: "openai", modelID: "gpt-5.4-mini" },
              time: { created: Date.now() },
            } as any)
            yield* sessions.updatePart({
              id: "prt_compaction" as any,
              messageID: compaction.id,
              sessionID: child.id,
              type: "compaction",
              auto: true,
              overflow: true,
            } as any)

            const tool = yield* RuntimeSummaryTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "school",
              },
              {
                sessionID: parent.id,
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [
                  {
                    info: {
                      role: "assistant",
                      agent: "pentest",
                      modelID: "gpt-5.5",
                      providerID: "openai",
                      cost: 0.5,
                      tokens: {
                        input: 1000,
                        output: 400,
                        reasoning: 100,
                        cache: { read: 50, write: 0 },
                      },
                    },
                    parts: [],
                  },
                ] as any,
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))
            expect(record.modelCalls.total).toBe(2)
            expect(record.modelCalls.byModel["gpt-5.5"]).toBe(1)
            expect(record.modelCalls.byModel["gpt-5.4-mini"]).toBe(1)
            expect(record.usage.totalTokens).toBe(2500)
            expect(record.usage.byAgent.pentest.totalTokens).toBe(1500)
            expect(record.usage.byAgent.recon.totalTokens).toBe(1000)
            expect(record.compaction.count).toBe(1)
            expect(record.compaction.pressure).toBe("low")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("includes persisted background jobs when backgroundTasks is omitted", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const worktree = Instance.worktree
            yield* Effect.promise(() =>
              writeOperationCheckpoint(worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "validation",
                status: "running",
                summary: "Validation is still running.",
              }),
            )

            const jobs = yield* BackgroundJob.Service
            const storage = yield* Storage.Service
            const id = `tool_${crypto.randomUUID().replaceAll("-", "")}`
            yield* Effect.addFinalizer(() => storage.remove(["background_job", id]).pipe(Effect.ignore))
            yield* jobs.start({
              id,
              type: "task",
              title: "validate weak mfa",
              metadata: {
                subagent: "validator",
              },
              run: Effect.succeed("MFA bypass validation completed."),
            })
            expect((yield* jobs.wait({ id })).info?.status).toBe("completed")

            const tool = yield* RuntimeSummaryTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "school",
              },
              {
                sessionID: "session-1" as any,
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))
            expect(record.backgroundTasks).toEqual([
              {
                id,
                agent: "validator",
                status: "completed",
                summary: "validate weak mfa",
              },
            ])
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })

  test("includes stale background job restart args when backgroundTasks is omitted", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const worktree = Instance.worktree
            yield* Effect.promise(() =>
              writeOperationCheckpoint(worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "validation",
                status: "running",
                summary: "Validation is still running.",
              }),
            )

            const jobs = yield* BackgroundJob.Service
            const storage = yield* Storage.Service
            const id = `tool_${crypto.randomUUID().replaceAll("-", "")}`
            yield* Effect.addFinalizer(() => storage.remove(["background_job", id]).pipe(Effect.ignore))
            yield* jobs.start({
              id,
              type: "task",
              title: "stale validator",
              metadata: {
                sessionID: id,
                subagent: "validator",
                subagent_type: "validator",
                description: "stale validator",
                prompt: "continue stale validation",
                operationID: "school",
              },
              run: Effect.never,
            })

            const result = yield* Effect.gen(function* () {
              const tool = yield* RuntimeSummaryTool
              const def = yield* tool.init()
              return yield* def.execute(
                {
                  operationID: "school",
                },
                {
                  sessionID: "session-1" as any,
                  messageID: MessageID.ascending(),
                  agent: "build",
                  abort: new AbortController().signal,
                  messages: [],
                  metadata: () => Effect.void,
                  ask: () => Effect.void,
                },
              )
            }).pipe(Effect.provide(Layer.fresh(BackgroundJob.layer)))

            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))
            expect(record.backgroundTasks).toEqual([
              {
                id,
                agent: "validator",
                status: "stale",
                summary: "stale validator",
                restartArgs: {
                  task_id: id,
                  background: true,
                  description: "stale validator",
                  prompt: "continue stale validation",
                  subagent_type: "validator",
                  operationID: "school",
                },
              },
            ])
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })

  test("scopes persisted background jobs to the requested operation when operation metadata exists", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const worktree = Instance.worktree
            yield* Effect.promise(() =>
              writeOperationCheckpoint(worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "validation",
                status: "running",
                summary: "Validation is still running.",
              }),
            )

            const jobs = yield* BackgroundJob.Service
            const storage = yield* Storage.Service
            const schoolID = `tool_${crypto.randomUUID().replaceAll("-", "")}`
            const otherID = `tool_${crypto.randomUUID().replaceAll("-", "")}`
            const legacyID = `tool_${crypto.randomUUID().replaceAll("-", "")}`
            yield* Effect.addFinalizer(() =>
              Effect.all(
                [schoolID, otherID, legacyID].map((id) => storage.remove(["background_job", id]).pipe(Effect.ignore)),
              ).pipe(Effect.asVoid),
            )
            yield* jobs.start({
              id: schoolID,
              type: "task",
              title: "school validation",
              metadata: { operationID: "school", subagent: "validator" },
              run: Effect.succeed("school done"),
            })
            yield* jobs.start({
              id: otherID,
              type: "task",
              title: "other validation",
              metadata: { operationID: "other", subagent: "validator" },
              run: Effect.succeed("other done"),
            })
            yield* jobs.start({
              id: legacyID,
              type: "task",
              title: "legacy validation",
              metadata: { subagent: "validator" },
              run: Effect.succeed("legacy done"),
            })
            expect((yield* jobs.wait({ id: schoolID })).info?.status).toBe("completed")
            expect((yield* jobs.wait({ id: otherID })).info?.status).toBe("completed")
            expect((yield* jobs.wait({ id: legacyID })).info?.status).toBe("completed")

            const tool = yield* RuntimeSummaryTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "school",
              },
              {
                sessionID: "session-1" as any,
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))
            expect(record.backgroundTasks).toEqual([
              {
                id: schoolID,
                agent: "validator",
                status: "completed",
                summary: "school validation",
              },
            ])
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })

  test("includes persisted background job session usage outside the child tree", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const worktree = Instance.worktree
            yield* Effect.promise(() =>
              writeOperationCheckpoint(worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "validation",
                status: "running",
                summary: "Validation is still running.",
              }),
            )

            const sessions = yield* Session.Service
            const jobs = yield* BackgroundJob.Service
            const storage = yield* Storage.Service
            const parent = yield* sessions.create({ title: "parent" })
            const detached = yield* sessions.create({ title: "detached validator" })
            yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "assistant",
              parentID: MessageID.ascending(),
              sessionID: detached.id,
              mode: "validator",
              agent: "validator",
              cost: 0.75,
              path: { cwd: worktree, root: worktree },
              tokens: {
                input: 700,
                output: 250,
                reasoning: 50,
                cache: { read: 0, write: 0 },
              },
              modelID: "gpt-5.5",
              providerID: "openai",
              time: { created: Date.now(), completed: Date.now() },
            } as any)

            yield* Effect.addFinalizer(() => storage.remove(["background_job", detached.id]).pipe(Effect.ignore))
            yield* jobs.start({
              id: detached.id,
              type: "task",
              title: "detached validation",
              metadata: {
                sessionID: detached.id,
                subagent: "validator",
              },
              run: Effect.succeed("validation completed"),
            })
            expect((yield* jobs.wait({ id: detached.id })).info?.status).toBe("completed")

            const tool = yield* RuntimeSummaryTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "school",
              },
              {
                sessionID: parent.id,
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))
            expect(record.modelCalls.total).toBe(1)
            expect(record.usage.totalTokens).toBe(1000)
            expect(record.usage.byAgent.validator.costUSD).toBe(0.75)
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })

  test("uses persisted background job usage snapshot when session messages are unavailable", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const worktree = Instance.worktree
            yield* Effect.promise(() =>
              writeOperationCheckpoint(worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "validation",
                status: "running",
                summary: "Validation is still running.",
              }),
            )

            const sessions = yield* Session.Service
            const jobs = yield* BackgroundJob.Service
            const storage = yield* Storage.Service
            const parent = yield* sessions.create({ title: "parent" })
            const detached = yield* sessions.create({ title: "detached validator without messages" })
            yield* Effect.addFinalizer(() => storage.remove(["background_job", detached.id]).pipe(Effect.ignore))
            yield* jobs.start({
              id: detached.id,
              type: "task",
              title: "snapshot validation",
              metadata: {
                sessionID: detached.id,
                subagent: "validator",
                operationID: "school",
                runtimeMessages: [
                  {
                    role: "assistant",
                    agent: "validator",
                    modelID: "gpt-5.5",
                    providerID: "openai",
                    cost: 0.33,
                    tokens: {
                      input: 400,
                      output: 120,
                      reasoning: 80,
                      cache: { read: 0, write: 0 },
                    },
                  },
                ],
              },
              run: Effect.succeed("validation completed"),
            })
            expect((yield* jobs.wait({ id: detached.id })).info?.status).toBe("completed")

            const tool = yield* RuntimeSummaryTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "school",
              },
              {
                sessionID: parent.id,
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))
            expect(record.modelCalls.total).toBe(1)
            expect(record.usage.totalTokens).toBe(600)
            expect(record.usage.costUSD).toBe(0.33)
            expect(record.usage.byAgent.validator.totalTokens).toBe(600)
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })
})
