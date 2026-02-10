import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"

const model = {
  providerID: "openai",
  api: { id: "gpt-5" },
} as any

describe("session.system prompt layering", () => {
  test("includes cyber core by default", () => {
    const prompt = SystemPrompt.instructions()
    expect(prompt).toContain("internal cybersecurity harness")
  })

  test("can exclude cyber core for hidden utility agents", () => {
    const prompt = SystemPrompt.instructions({ includeCyber: false })
    expect(prompt).not.toContain("internal cybersecurity harness")
  })

  test("provider prompt excludes cyber block when requested", () => {
    const prompts = SystemPrompt.provider(model, { includeCyber: false })
    expect(prompts.length).toBe(1)
  })
})
