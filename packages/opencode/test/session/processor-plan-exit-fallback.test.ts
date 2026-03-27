import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { SessionProcessor } from "../../src/session/processor"
import * as QuestionModule from "../../src/question"
import type { MessageV2 } from "../../src/session/message-v2"
import { Provider } from "../../src/provider/provider"

describe("session.processor plan_exit fallback", () => {
  let askSpy: any

  beforeEach(() => {
    askSpy = spyOn(QuestionModule.Question, "ask")
  })

  afterEach(() => {
    askSpy.mockRestore()
  })

  async function seedAssistant(input: { sessionID: string; text: string; agent?: string }) {
    const agent = input.agent ?? "plan"
    const assistant = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: Identifier.ascending("message"),
      mode: agent,
      agent,
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: "gpt-5",
      providerID: "openai",
      time: { created: Date.now() },
      sessionID: input.sessionID,
    })) as MessageV2.Assistant

    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: assistant.id,
      sessionID: input.sessionID,
      type: "text",
      text: input.text,
    })

    return assistant
  }

  async function seedPlanAssistant(input: { sessionID: string; text: string }) {
    return seedAssistant({ ...input, agent: "plan" })
  }

  test("switches from pentest_flow to pentest when model prints plan_exit text", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
        })
        await Session.update(session.id, (draft) => {
          draft.environment = {
            type: "cyber",
            root: `${tmp.path}/engagements/fixture`,
            engagementID: "fixture",
            created: Date.now(),
            rootSessionID: session.id,
            scaffoldVersion: "v1",
          }
        })

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

        const assistant = await seedPlanAssistant({ sessionID: session.id, text: "looks good\nplan_exit" })
        askSpy.mockResolvedValueOnce([["Continue with plan"]])
        const model = await Provider.defaultModel()

        const handled = await SessionProcessor.fallbackPlanExitIfNeeded({
          sessionID: session.id,
          assistantMessage: assistant,
          model,
        })

        expect(handled).toBe(true)
        const messages = await Session.messages({ sessionID: session.id })
        const latestUser = messages.findLast((msg) => msg.info.role === "user")
        expect(latestUser?.info.agent).toBe("pentest")
        expect(
          latestUser?.parts.some(
            (part) =>
              part.type === "text" &&
              part.text.includes("Create or update your todo list now") &&
              part.text.includes("Delegate specialized work early using the task tool"),
          ),
        ).toBe(true)
      },
    })
  })

  test("keeps plan mode when user rejects execution switch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
        })
        await Session.update(session.id, (draft) => {
          draft.environment = {
            type: "cyber",
            root: `${tmp.path}/engagements/fixture`,
            engagementID: "fixture",
            created: Date.now(),
            rootSessionID: session.id,
            scaffoldVersion: "v1",
          }
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "build",
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

        const assistant = await seedPlanAssistant({ sessionID: session.id, text: "plan_exit" })
        askSpy.mockResolvedValueOnce([["Make changes"]])
        const model = await Provider.defaultModel()

        const handled = await SessionProcessor.fallbackPlanExitIfNeeded({
          sessionID: session.id,
          assistantMessage: assistant,
          model,
        })

        expect(handled).toBe(true)
        const messages = await Session.messages({ sessionID: session.id })
        const latestUser = messages.findLast((msg) => msg.info.role === "user")
        expect(latestUser?.info.agent).toBe("plan")
      },
    })
  })

  test("does nothing when plan_exit tool already ran", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
        })
        await Session.update(session.id, (draft) => {
          draft.environment = {
            type: "cyber",
            root: `${tmp.path}/engagements/fixture`,
            engagementID: "fixture",
            created: Date.now(),
            rootSessionID: session.id,
            scaffoldVersion: "v1",
          }
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() },
        })
        const assistant = await seedPlanAssistant({ sessionID: session.id, text: "plan_exit" })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistant.id,
          sessionID: session.id,
          type: "tool",
          callID: "call_1",
          tool: "plan_exit",
          state: {
            status: "completed",
            input: {},
            output: "ok",
            title: "ok",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })

        const handled = await SessionProcessor.fallbackPlanExitIfNeeded({
          sessionID: session.id,
          assistantMessage: assistant,
          model: await Provider.defaultModel(),
        })

        expect(handled).toBe(false)
        expect(askSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("works even when session is not tagged as cyber environment", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "build",
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

        const assistant = await seedPlanAssistant({ sessionID: session.id, text: "plan_exit" })
        askSpy.mockResolvedValueOnce([["Continue with plan"]])

        const handled = await SessionProcessor.fallbackPlanExitIfNeeded({
          sessionID: session.id,
          assistantMessage: assistant,
          model: await Provider.defaultModel(),
        })

        expect(handled).toBe(true)
        const messages = await Session.messages({ sessionID: session.id })
        const latestUser = messages.findLast((msg) => msg.info.role === "user")
        expect(latestUser?.info.agent).toBe("build")
      },
    })
  })

  test("falls back to pentest when build is no longer a runnable primary agent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "opencode.json"),
      JSON.stringify({
        default_agent: "pentest",
        agent: {
          build: {
            mode: "subagent",
          },
        },
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "build",
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

        const assistant = await seedPlanAssistant({ sessionID: session.id, text: "plan_exit" })
        askSpy.mockResolvedValueOnce([["Continue with plan"]])

        const handled = await SessionProcessor.fallbackPlanExitIfNeeded({
          sessionID: session.id,
          assistantMessage: assistant,
          model: await Provider.defaultModel(),
        })

        expect(handled).toBe(true)
        const messages = await Session.messages({ sessionID: session.id })
        const latestUser = messages.findLast((msg) => msg.info.role === "user")
        expect(latestUser?.info.agent).toBe("pentest")
      },
    })
  })

  test("routes to pentest instead of build for cyber sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.update(session.id, (draft) => {
          draft.environment = {
            type: "cyber",
            root: `${tmp.path}/engagements/fixture`,
            engagementID: "fixture",
            created: Date.now(),
            rootSessionID: session.id,
            scaffoldVersion: "v1",
          }
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "build",
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

        const assistant = await seedPlanAssistant({ sessionID: session.id, text: "plan_exit" })
        askSpy.mockResolvedValueOnce([["Continue with plan"]])

        const handled = await SessionProcessor.fallbackPlanExitIfNeeded({
          sessionID: session.id,
          assistantMessage: assistant,
          model: await Provider.defaultModel(),
        })

        expect(handled).toBe(true)
        const latestUser = (await Session.messages({ sessionID: session.id })).findLast((msg) => msg.info.role === "user")
        expect(latestUser?.info.agent).toBe("pentest")
      },
    })
  })

  test("recovers when approval was explicit but assistant emits literal plan_exit outside plan agent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.update(session.id, (draft) => {
          draft.environment = {
            type: "cyber",
            root: `${tmp.path}/engagements/fixture`,
            engagementID: "fixture",
            created: Date.now(),
            rootSessionID: session.id,
            scaffoldVersion: "v1",
          }
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "pentest",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() - 50 },
        })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() - 40 },
        })
        await seedPlanAssistant({ sessionID: session.id, text: "Does this plan look good?" })
        const approval = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "pentest",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() - 20 },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: approval.id,
          sessionID: session.id,
          type: "text",
          text: "yeah sure go ahead",
        })

        const assistant = await seedAssistant({
          sessionID: session.id,
          agent: "pentest",
          text: "plan_exit",
        })

        const handled = await SessionProcessor.fallbackPlanExitIfNeeded({
          sessionID: session.id,
          assistantMessage: assistant,
          model: await Provider.defaultModel(),
        })

        expect(handled).toBe(true)
        expect(askSpy).toHaveBeenCalledTimes(0)
        const latestUser = (await Session.messages({ sessionID: session.id })).findLast((msg) => msg.info.role === "user")
        expect(latestUser?.info.agent).toBe("pentest")
        expect(
          latestUser?.parts.some(
            (part) =>
              part.type === "text" &&
              part.text.includes("You are now in pentest mode") &&
              part.text.includes("Delegate specialized work early using the task tool"),
          ),
        ).toBe(true)
      },
    })
  })

  test("does not auto-approve when the user only promises future approval", async () => {
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
          time: { created: Date.now() - 50 },
        })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() - 40 },
        })
        await seedPlanAssistant({
          sessionID: session.id,
          text: "Here is the plan. I can execute after you confirm.",
        })

        const futureApproval = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5" },
          time: { created: Date.now() - 20 },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: futureApproval.id,
          sessionID: session.id,
          type: "text",
          text: "come up with a plan to test your tools, i'll give you the go ahead later",
        })

        const assistant = await seedPlanAssistant({
          sessionID: session.id,
          text: "I have the plan ready.",
        })
        askSpy.mockResolvedValueOnce([["Make changes"]])

        const handled = await SessionProcessor.fallbackPlanExitIfNeeded({
          sessionID: session.id,
          assistantMessage: assistant,
          model: await Provider.defaultModel(),
        })

        expect(handled).toBe(false)
        expect(askSpy).not.toHaveBeenCalled()
        const latestUser = (await Session.messages({ sessionID: session.id })).findLast((msg) => msg.info.role === "user")
        expect(latestUser?.info.agent).toBe("plan")
      },
    })
  })
})
