import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Agent } from "../agent/agent"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

async function getLastUserAgent(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role !== "user") continue
    if (!item.info.agent) continue
    return item.info.agent
  }
  return "pentest"
}

async function getPrePlanAgent(sessionID: string) {
  let sawPlan = false
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role !== "user") continue
    const agent = item.info.agent
    if (!agent) continue
    if (agent === "plan") {
      sawPlan = true
      continue
    }
    if (sawPlan) return agent
  }
  return "pentest"
}

function executionAgent(agent: string) {
  if (agent === "pentest_auto" || agent === "pentest_flow" || agent === "AutoPentest") return "pentest"
  return agent
}

function executionKickoff(input: { planPath: string; agent: string }) {
  if (input.agent !== "pentest") {
    return `The plan at ${input.planPath} has been approved. You are now back in ${input.agent} mode. Execute the plan.`
  }
  return [
    `The plan at ${input.planPath} has been approved. You are now in pentest mode.`,
    "Create or update your todo list now with concrete execution tasks and priorities.",
    "Begin executing the approved plan immediately and capture evidence as you go.",
    "Delegate specialized work early using the task tool with subagents (recon, assess, report, network_mapper, host_auditor, vuln_researcher, evidence_scribe).",
  ].join("\n")
}

async function resolveExecutionAgent(sessionID: string) {
  const session = await Session.get(sessionID)
  const preferred = executionAgent(await getPrePlanAgent(sessionID))
  if (session.environment?.type === "cyber" && preferred === "build") {
    const pentest = await Agent.get("pentest")
    if (pentest && pentest.mode !== "subagent") return "pentest"
  }
  const preferredAgent = await Agent.get(preferred)
  if (preferredAgent && preferredAgent.mode !== "subagent") return preferred

  const pentest = await Agent.get("pentest")
  if (pentest && pentest.mode !== "subagent") return "pentest"

  return Agent.defaultAgent()
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))
    const previousAgent = await resolveExecutionAgent(ctx.sessionID)
    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: previousAgent,
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: executionKickoff({ planPath: plan, agent: previousAgent }),
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: `Switching to ${previousAgent} agent`,
      output: `Switched to ${previousAgent}. Continue execution immediately.`,
      metadata: {},
    }
  },
})

export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))
    const currentAgent = await getLastUserAgent(ctx.sessionID)

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to the plan agent and create a plan saved to ${plan}?`,
          header: "Plan Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to plan agent for research and planning" },
            { label: "No", description: `Stay with ${currentAgent} to continue execution` },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]

    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "plan",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: "User has requested to enter plan mode. Switch to plan mode and begin planning.",
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to plan agent",
      output: `User confirmed to switch to plan mode. A new message has been created to switch you to plan mode. The plan file will be at ${plan}. Begin planning.`,
      metadata: {},
    }
  },
})
