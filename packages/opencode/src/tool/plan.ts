import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Agent } from "../agent/agent"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import { type SessionID, MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"
import { CyberEnvironment } from "@/session/environment"
import { SwarmAggressionPolicy, SwarmTeamManager, SwarmTelemetry } from "@/features/swarm"

async function getLastModel(sessionID: SessionID) {
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
    let session = await Session.get(ctx.sessionID)
    const activeAgent = await getLastUserAgent(ctx.sessionID)
    if (activeAgent !== "plan") {
      return {
        title: "Already in execution mode",
        output: "Plan handoff skipped because this session is not currently in plan mode.",
        metadata: {
          approvalIntentDetected: false,
        },
      }
    }
    const plan = path.relative(Instance.worktree, Session.plan(session))
    const previousAgent = await resolveExecutionAgent(ctx.sessionID)
    const model = await getLastModel(ctx.sessionID)
    const v21 = await SwarmTeamManager.v21Flags()

    if (previousAgent === "pentest" && v21.enabled) {
      const ensured = await CyberEnvironment.ensureSharedEnvironment({
        session,
        agentName: "pentest",
        force: true,
      })
      if (ensured.environment && (ensured.created || ensured.changed || !session.environment)) {
        session = await Session.update(session.id, (draft) => {
          draft.environment = ensured.environment
        })
      }

      if (v21.askAggressionOnPlanExit) {
        const existingPolicy = await CyberEnvironment.readSwarmPolicy(session)
        if (!existingPolicy) {
          let selected = v21.defaultAggression
          let source = "plan_exit_intake"
          try {
            const answers = await Question.ask({
              sessionID: ctx.sessionID,
              questions: [
                {
                  question: "Choose swarm aggression for this engagement.",
                  header: "Swarm Aggression",
                  custom: false,
                  options: [
                    { label: "None", description: "No subagent delegation. Planner runs solo." },
                    { label: "Low", description: "Tight fanout with conservative delegation depth." },
                    { label: "Balanced", description: "Default balance of speed and control." },
                    { label: "High", description: "Aggressive parallelism with safety controls." },
                    { label: "Max parallel", description: "Maximum parallel fanout with safety guardrails." },
                  ],
                },
              ],
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })
            selected = SwarmAggressionPolicy.normalize(answers[0]?.[0], v21.defaultAggression)
          } catch (error) {
            if (error instanceof Question.RejectedError) throw error
            source = "fallback_default"
            await SwarmTelemetry.event({
              sessionID: ctx.sessionID,
              type: "swarm_aggression_warning",
              payload: {
                warning: "plan_exit_question_unavailable",
                fallback: v21.defaultAggression,
                error: (error as Error)?.message ?? "unknown",
              },
            })
          }
          const policy = await CyberEnvironment.writeSwarmPolicy({
            session,
            swarm_aggression: selected,
            set_by_session_id: ctx.sessionID,
            maxParallelDepthCap: v21.maxParallelDepthCap,
          })
          await SwarmTelemetry.event({
            sessionID: ctx.sessionID,
            type: "swarm_aggression_set",
            payload: {
              swarm_aggression: policy?.swarm_aggression ?? selected,
              source,
              engagement_id:
                policy?.engagement_id ??
                (session.environment?.type === "cyber" ? session.environment.engagementID : null),
            },
          })
        }
      }
    }

    const userMsg: MessageV2.User = {
      id: MessageID.ascending(),
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
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: executionKickoff({ planPath: plan, agent: previousAgent }),
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: `Switching to ${previousAgent} agent`,
      output: `Switched to ${previousAgent}. Continue execution immediately.`,
      metadata: {
        approvalIntentDetected: true,
      },
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
      id: MessageID.ascending(),
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
      id: PartID.ascending(),
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
