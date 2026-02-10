import { describe, expect, test } from "bun:test"
import { CyberEnvironment } from "../../src/session/environment"
import type { MessageV2 } from "../../src/session/message-v2"

function messages(parts: MessageV2.Part[]): MessageV2.WithParts[] {
  return [
    {
      info: {
        id: "message_1",
        sessionID: "session_1",
        role: "assistant",
        parentID: "message_0",
        modelID: "gpt-5",
        providerID: "openai",
        mode: "pentest",
        agent: "pentest",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        time: { created: Date.now() },
      },
      parts,
    } as MessageV2.WithParts,
  ]
}

describe("session.prompt cyber reminder helpers", () => {
  test("detects absence/presence of loaded skill tool calls", () => {
    expect(CyberEnvironment.hasLoadedSkill(messages([]))).toBe(false)
    expect(
      CyberEnvironment.hasLoadedSkill(
        messages([
          {
            id: "part_1",
            sessionID: "session_1",
            messageID: "message_1",
            type: "tool",
            callID: "call_1",
            tool: "skill",
            state: {
              status: "completed",
              input: { name: "demo" },
              output: "loaded",
              title: "Loaded skill: demo",
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            },
          },
        ]),
      ),
    ).toBe(true)
  })

  test("detects one-time skill reminder marker", () => {
    expect(CyberEnvironment.hasSkillReminderBeenShown(messages([]))).toBe(false)
    expect(
      CyberEnvironment.hasSkillReminderBeenShown(
        messages([
          {
            id: "part_2",
            sessionID: "session_1",
            messageID: "message_1",
            type: "text",
            synthetic: true,
            text: `<system-reminder>\n${CyberEnvironment.SKILL_REMINDER_MARKER}\nwarning\n</system-reminder>`,
          },
        ]),
      ),
    ).toBe(true)
  })
})
