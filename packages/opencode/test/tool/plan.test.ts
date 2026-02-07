import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { PlanEnterTool, PlanExitTool } from "../../src/tool/plan"
import * as QuestionModule from "../../src/question"

const ctx = {
  messageID: "test-message",
  callID: "test-call",
  agent: "plan",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: async () => {},
  ask: async () => {},
}

describe("tool.plan", () => {
  let askSpy: any

  beforeEach(() => {
    askSpy = spyOn(QuestionModule.Question, "ask")
  })

  afterEach(() => {
    askSpy.mockRestore()
  })

  test("plan_exit switches back to previous primary agent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "pentest",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() - 10 },
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() },
        })

        askSpy.mockResolvedValueOnce([["Yes"]])

        const tool = await PlanExitTool.init()
        await tool.execute({}, { ...ctx, sessionID: session.id })

        const msgs = await Session.messages({ sessionID: session.id })
        const userMessages = msgs.filter((msg) => msg.info.role === "user")
        expect(userMessages.length).toBe(3)
        expect(
          msgs.some(
            (msg) =>
              msg.info.role === "user" &&
              msg.info.agent === "pentest" &&
              msg.parts.some(
                (part) => part.type === "text" && part.synthetic && part.text.includes("back in pentest mode"),
              ),
          ),
        ).toBe(true)
      },
    })
  })

  test("plan_enter keeps current agent in No option text", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "pentest_flow",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() },
        })

        askSpy.mockResolvedValueOnce([["No"]])

        const tool = await PlanEnterTool.init()
        await expect(tool.execute({}, { ...ctx, sessionID: session.id })).rejects.toBeInstanceOf(
          QuestionModule.Question.RejectedError,
        )

        const request = askSpy.mock.calls[0]?.[0]
        expect(request?.questions?.[0]?.options?.[1]?.description).toContain("pentest_flow")
      },
    })
  })

  test("plan_exit maps pentest_flow execution to pentest", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "pentest_flow",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() - 10 },
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() },
        })

        askSpy.mockResolvedValueOnce([["Yes"]])

        const tool = await PlanExitTool.init()
        await tool.execute({}, { ...ctx, sessionID: session.id })

        const request = askSpy.mock.calls[0]?.[0]
        expect(request?.questions?.[0]?.question).toContain("switch to the pentest agent")
        expect(
          (
            await Session.messages({ sessionID: session.id })
          ).some((msg) => msg.info.role === "user" && msg.info.agent === "pentest"),
        ).toBe(true)
      },
    })
  })

  test("plan_exit keeps backward compatibility for pentest_auto alias", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "pentest_auto",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() - 10 },
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() },
        })

        askSpy.mockResolvedValueOnce([["Yes"]])

        const tool = await PlanExitTool.init()
        await tool.execute({}, { ...ctx, sessionID: session.id })

        expect(
          (
            await Session.messages({ sessionID: session.id })
          ).some((msg) => msg.info.role === "user" && msg.info.agent === "pentest"),
        ).toBe(true)
      },
    })
  })
})
