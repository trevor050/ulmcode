import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeSummaryTool } from "@/tool/runtime_summary"
import { Truncate } from "@/tool/truncate"
import { writeOperationCheckpoint } from "@/ulm/artifact"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "@/project/instance"
import { MessageID } from "@/session/schema"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

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
})
