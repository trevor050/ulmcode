import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { MessageID } from "@/session/schema"
import { OperationAuditTool } from "@/tool/operation_audit"
import { Truncate } from "@/tool/truncate"
import { writeOperationCheckpoint } from "@/ulm/artifact"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

describe("tool.operation_audit", () => {
  test("prints audit markdown before raw audit json and writes audit files", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              writeOperationCheckpoint(Instance.worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "handoff",
                status: "complete",
                summary: "Ready for handoff review.",
                nextActions: ["Review final package"],
              }),
            )

            const tool = yield* OperationAuditTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              { operationID: "school" },
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

            expect(result.title).toContain("operation audit blockers")
            expect(result.output).toStartWith("# Operation Audit school")
            expect(result.output).toContain("<operation_audit_json>")
            expect(result.output).toContain("final_handoff: attention_required")
            expect(result.metadata.ok).toBe(false)
            expect(result.metadata.recommendedTools).toContain("report_render")
            const markdown = yield* Effect.promise(() => fs.readFile(result.metadata.files.markdown, "utf8"))
            expect(markdown).toContain("operation plan is missing")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
