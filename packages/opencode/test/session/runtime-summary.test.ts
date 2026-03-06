import path from "path"
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { CyberEnvironment } from "../../src/session/environment"
import { PentestRuntimeSummary } from "../../src/session/runtime-summary"
import { Identifier } from "../../src/id/id"
import type { MessageV2 } from "../../src/session/message-v2"

describe("session.runtime-summary", () => {
  test("writes pentest runtime summary artifacts for parent and subagent sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "Root pentest" })
        const env = CyberEnvironment.create(root)
        await Session.update(root.id, (draft) => {
          draft.environment = env
        })
        await CyberEnvironment.ensureSharedScaffold({ environment: env, session: root })

        const child = await Session.create({ parentID: root.id, title: "Recon lane" })
        await Session.update(child.id, (draft) => {
          draft.environment = env
        })
        await CyberEnvironment.ensureSharedScaffold({ environment: env, session: child })
        await CyberEnvironment.ensureSubagentWorkspace({ environment: env, session: child })

        const rootUser = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: root.id,
          role: "user",
          time: { created: Date.now() - 5_000 },
          agent: "pentest",
          model: { providerID: "openai", modelID: "gpt-5.4" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)
        const rootAssistant = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: root.id,
          role: "assistant",
          parentID: rootUser.id,
          providerID: "openai",
          modelID: "gpt-5.4",
          mode: "default",
          agent: "pentest",
          path: { cwd: tmp.path, root: tmp.path },
          time: { created: Date.now() - 4_000, completed: Date.now() - 3_500 },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } as unknown as MessageV2.Info)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: root.id,
          messageID: rootAssistant.id,
          type: "step-finish",
          reason: "tool-calls",
          cost: 0,
          tokens: {
            total: 1200,
            input: 400,
            output: 500,
            reasoning: 300,
            cache: { read: 0, write: 0 },
          },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: root.id,
          messageID: rootAssistant.id,
          type: "tool",
          callID: "call_root_tool",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "nmap -sV 127.0.0.1" },
            title: "Background scan",
            output: "[pentest-runtime] summarized",
            metadata: {
              pentest_runtime: {
                raw_output_bytes: 18_000,
                visible_output_bytes: 240,
                output_summarized: true,
                truncated_handoff: true,
                artifact_path: path.join(env.root, "evidence", "processed", "tool-output", "scan.log"),
              },
            },
            time: { start: Date.now() - 4_000, end: Date.now() - 3_800 },
          },
        } as unknown as MessageV2.Part)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: root.id,
          messageID: rootAssistant.id,
          type: "compaction",
          auto: true,
        })

        const childUser = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: child.id,
          role: "user",
          time: { created: Date.now() - 3_000 },
          agent: "recon",
          model: { providerID: "openai", modelID: "gpt-5.4" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)
        const childAssistant = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: child.id,
          role: "assistant",
          parentID: childUser.id,
          providerID: "openai",
          modelID: "gpt-5.4",
          mode: "default",
          agent: "recon",
          path: { cwd: tmp.path, root: tmp.path },
          time: { created: Date.now() - 2_500, completed: Date.now() - 2_000 },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } as unknown as MessageV2.Info)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: child.id,
          messageID: childAssistant.id,
          type: "step-finish",
          reason: "stop",
          cost: 0,
          tokens: {
            total: 900,
            input: 300,
            output: 400,
            reasoning: 200,
            cache: { read: 0, write: 0 },
          },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: child.id,
          messageID: childAssistant.id,
          type: "tool",
          callID: "call_child_tool",
          tool: "web_search",
          state: {
            status: "completed",
            input: { q: "test" },
            title: "Search result",
            output: "short digest",
            metadata: {
              pentest_runtime: {
                raw_output_bytes: 500,
                visible_output_bytes: 120,
                output_summarized: false,
                truncated_handoff: false,
              },
            },
            time: { start: Date.now() - 2_300, end: Date.now() - 2_100 },
          },
        } as unknown as MessageV2.Part)

        const summary = await PentestRuntimeSummary.write({ sessionID: root.id })
        expect(summary).toBeDefined()
        expect(summary?.model_usage.parent.calls).toBe(1)
        expect(summary?.model_usage.subagents.calls).toBe(1)
        expect(summary?.context.compaction_count).toBe(1)
        expect(summary?.tooling.summarized_outputs).toBe(1)
        expect(summary?.tooling.truncated_handoffs).toBe(1)
        expect(summary?.tooling.total_output_bytes_raw).toBeGreaterThan(summary?.tooling.total_output_bytes_visible ?? 0)
        expect(await Bun.file(path.join(env.root, "deliverables", "runtime-summary.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "deliverables", "runtime-summary.md")).exists()).toBe(true)
      },
    })
  })
})
