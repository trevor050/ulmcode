import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { MessageID } from "@/session/schema"
import { OperationStageGateTool } from "@/tool/operation_stage_gate"
import { Truncate } from "@/tool/truncate"
import { writeOperationCheckpoint } from "@/ulm/artifact"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

describe("tool.operation_stage_gate", () => {
  test("prints stage gate markdown before raw gate json", async () => {
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
                summary: "Recon started.",
              }),
            )

            const tool = yield* OperationStageGateTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              { operationID: "school", stage: "recon" },
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

            expect(result.title).toContain("stage gate gaps")
            expect(result.output).toStartWith("# Stage Gate school/recon")
            expect(result.output).toContain("<operation_stage_gate_json>")
            expect(result.metadata.ok).toBe(false)
            expect(result.metadata.gaps).toContain("operation plan is missing")
            expect(result.metadata.gaps).toContain("recon has no recorded evidence")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
