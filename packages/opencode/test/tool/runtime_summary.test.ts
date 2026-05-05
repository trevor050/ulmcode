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
})
