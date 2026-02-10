import { describe, expect, test } from "bun:test"
import { CyberEnvironment } from "../../src/session/environment"
import type { MessageV2 } from "../../src/session/message-v2"

function toolPart(input: {
  tool: string
  status: "completed" | "error" | "running" | "pending"
  subagent_type?: string
}) {
  return {
    id: "part_1",
    sessionID: "session_1",
    messageID: "message_1",
    type: "tool" as const,
    callID: "call_1",
    tool: input.tool,
    state: {
      status: input.status,
      input: input.subagent_type ? { subagent_type: input.subagent_type } : {},
      ...(input.status === "completed"
        ? {
            output: "ok",
            title: "done",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          }
        : input.status === "error"
          ? {
              error: "failed",
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            }
          : input.status === "running"
            ? {
                metadata: {},
                time: { start: Date.now() },
              }
            : { raw: "raw" }),
    },
  } as MessageV2.ToolPart
}

describe("prompt report_writer enforcement helpers", () => {
  test("detects completed cyber subtasks", () => {
    const messages: MessageV2.WithParts[] = [
      {
        info: { id: "message_1", sessionID: "session_1", role: "user", time: { created: Date.now() }, agent: "pentest", model: { providerID: "openai", modelID: "gpt-5" } },
        parts: [toolPart({ tool: "task", status: "completed", subagent_type: "recon" })],
      } as MessageV2.WithParts,
    ]
    expect(CyberEnvironment.hasCompletedCyberSubtask(messages)).toBe(true)
  })

  test("detects report_writer task attempts to avoid relaunch loops", () => {
    const messages: MessageV2.WithParts[] = [
      {
        info: { id: "message_1", sessionID: "session_1", role: "user", time: { created: Date.now() }, agent: "pentest", model: { providerID: "openai", modelID: "gpt-5" } },
        parts: [toolPart({ tool: "task", status: "error", subagent_type: "report_writer" })],
      } as MessageV2.WithParts,
    ]
    expect(CyberEnvironment.hasReportWriterRun(messages)).toBe(true)
  })
})
