import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID } from "@/session/schema"
import { ToolInventoryTool } from "@/tool/tool_inventory"
import { Truncate } from "@/tool/truncate"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

describe("tool.tool_inventory", () => {
  test("prints inventory summary and raw json", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* ToolInventoryTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              { operationID: "School", includeVersions: false, writeArtifacts: true },
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

            expect(result.title).toStartWith("Tool inventory:")
            expect(result.output).toContain("<tool_inventory_json>")
            expect(result.output).toContain("Use tool_acquire with install=true only after operator authorization.")
            expect(result.metadata.operationID).toBe("school")
            expect(result.metadata.json).toContain("tool-inventory.json")
            expect(result.metadata.markdown).toContain("tool-inventory.md")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
