import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { MessageID } from "@/session/schema"
import { OperationResumeTool } from "@/tool/operation_resume"
import { Truncate } from "@/tool/truncate"
import { writeOperationCheckpoint } from "@/ulm/artifact"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

describe("tool.operation_resume", () => {
  test("prints a restart brief before raw resume json", async () => {
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
                stage: "recon",
                status: "running",
                summary: "Recon lane started.",
                nextActions: ["Check task outputs"],
                activeTasks: ["task-recon-1"],
              }),
            )

            const tool = yield* OperationResumeTool
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

            expect(result.title).toBe("Resume school: attention_required")
            expect(result.output).toStartWith("# Resume school")
            expect(result.output).toContain("operation plan is missing")
            expect(result.output).toContain("<operation_resume_json>")
            expect(result.output).toContain("\"operationID\": \"school\"")
            expect(result.metadata.health.ready).toBe(false)
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
