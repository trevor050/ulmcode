import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID } from "@/session/schema"
import { OperationSuperviseTool } from "@/tool/operation_supervise"
import { Truncate } from "@/tool/truncate"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

describe("tool.operation_supervise", () => {
  test("prints supervisor decisions and raw review json", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationSuperviseTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              { operationID: "School", reviewKind: "startup", maxActions: 1 },
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

            expect(result.title).toBe("Supervisor school: blocked")
            expect(result.output).toContain("next_tool: operation_goal")
            expect(result.output).toContain("<operation_supervise_json>")
            expect(result.metadata.actions).toEqual(["blocked"])
            expect(result.metadata.nextTools).toEqual(["operation_goal"])
            expect(result.metadata.files?.json).toContain("supervisor-review-")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
