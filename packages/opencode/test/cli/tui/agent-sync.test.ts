import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2"
import { latestPrimaryAgent } from "../../../src/cli/cmd/tui/routes/session/agent-sync"

describe("tui agent sync", () => {
  test("returns the latest user message agent present in primary list", () => {
    const messages = [
      { role: "user", agent: "pentest" },
      { role: "assistant", agent: "plan" },
      { role: "user", agent: "plan" },
    ] as Message[]
    const result = latestPrimaryAgent({
      messages,
      primaryAgents: ["action", "plan", "pentest"],
    })
    expect(result).toBe("plan")
  })

  test("ignores agents that are not primary-visible", () => {
    const messages = [{ role: "user", agent: "recon" }] as Message[]
    const result = latestPrimaryAgent({
      messages,
      primaryAgents: ["action", "plan", "pentest"],
    })
    expect(result).toBeUndefined()
  })
})

