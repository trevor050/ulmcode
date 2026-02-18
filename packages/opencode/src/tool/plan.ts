import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import { type SessionID, MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
<<<<<<< HEAD
=======
import ENTER_DESCRIPTION from "./plan-enter.txt"
import { CyberEnvironment } from "@/session/environment"
import { SwarmAggressionPolicy, SwarmTeamManager, SwarmTelemetry } from "@/features/swarm"
>>>>>>> 4211dc3af (feat(swarm): add v2.1 pentest plan-time aggression policy)

async function getLastModel(sessionID: SessionID) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    let session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
          header: "Build Agent",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to build agent and start implementing the plan" },
            { label: "No", description: "Stay with plan agent to continue refining the plan" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    if (answer === "No") throw new Question.RejectedError()

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
                    { label: "none", description: "No subagent delegation. Planner runs solo." },
                    { label: "low", description: "Tight fanout with conservative delegation depth." },
                    { label: "balanced", description: "Default balance of speed and control." },
                    { label: "high", description: "Aggressive parallelism with safety controls." },
                    { label: "max_parallel", description: "Maximum parallel fanout with safety guardrails." },
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
      agent: "build",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to build agent",
      output: "User approved switching to build agent. Wait for further instructions.",
      metadata: {},
    }
  },
})

/*
export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to the plan agent and create a plan saved to ${plan}?`,
          header: "Plan Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to plan agent for research and planning" },
            { label: "No", description: "Stay with build agent to continue making changes" },
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
*/
