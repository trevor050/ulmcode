import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID } from "@/session/schema"
import { OperationGoalTool } from "@/tool/operation_goal"
import { Truncate } from "@/tool/truncate"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

const context = {
  sessionID: "session-1" as any,
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.operation_goal", () => {
  test("creates and reads durable operation goals", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationGoalTool
            const def = yield* tool.init()
            const created = yield* def.execute(
              {
                action: "create",
                operationID: "School",
                objective: "Authorized 20 hour district assessment",
                targetDurationHours: 20,
              },
              context,
            )

            expect(created.title).toBe("Created operation goal for school")
            expect(created.output).toContain("<operation_goal_json>")
            expect(created.metadata.created).toBe(true)
            expect(created.metadata.status).toBe("active")

            const read = yield* def.execute({ action: "read", operationID: "School" }, context)
            expect(read.title).toBe("Read operation goal for school")
            expect(read.output).toContain("Authorized 20 hour district assessment")
            expect(read.metadata.status).toBe("active")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("reports blockers when completion artifacts are missing", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationGoalTool
            const def = yield* tool.init()
            yield* def.execute(
              {
                action: "create",
                operationID: "school",
                objective: "Authorized 20 hour district assessment",
                targetDurationHours: 20,
              },
              context,
            )

            const result = yield* def.execute({ action: "complete", operationID: "school" }, context)
            expect(result.title).toBe("4 operation goal completion blockers")
            expect(result.metadata.completed).toBe(false)
            expect(result.metadata.blockers).toContain("deliverables/runtime-summary.json is missing or invalid")
            expect(result.output).toContain("blockers_json:")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
