import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { CyberEnvironment } from "@/session/environment"
import { BackgroundAgentManager } from "@/features/background-agent/manager"
import { SwarmIdentity, SwarmInbox, SwarmMeshRouter, SwarmTeamManager, SwarmTmux } from "@/features/swarm"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  run_in_background: z.boolean().optional(),
  coordination_scope: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional scope tags to claim while this subagent runs (prevents overlap)"),
  expected_output_schema: z.enum(["brief", "evidence_summary", "report_section"]).optional(),
  teammate_targets: z.array(z.string()).optional(),
  allow_scope_overlap: z.boolean().optional(),
  team_id: z.string().optional(),
  caller_id: z.string().optional(),
  delegation_mode: z.enum(["direct", "brokered"]).optional(),
  isolation_mode: z.enum(["shared", "isolated"]).optional(),
  retry_policy: z.enum(["none", "light", "aggressive"]).optional(),
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitForTerminalAssistant(input: {
  sessionID: string
  startedAt: number
  abort: AbortSignal
}) {
  while (true) {
    if (input.abort.aborted) return undefined
    const messages = await Session.messages({ sessionID: input.sessionID, limit: 30 })
    const match = [...messages]
      .reverse()
      .find(
        (item) =>
          item.info.role === "assistant" &&
          (item.info as MessageV2.Assistant).time.created >= input.startedAt &&
          (item.info as MessageV2.Assistant).time.completed &&
          (item.info as MessageV2.Assistant).finish,
      )
    if (match) return match
    await sleep(1_000)
  }
}

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary" && a.hidden !== true))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")
      const hasTodoWritePermission = agent.permission.some((rule) => rule.permission === "todowrite")

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            ...(hasTodoWritePermission
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const parent = await Session.get(ctx.sessionID)
      const environment = session.environment ?? parent.environment
      if (environment?.type === "cyber") {
        await CyberEnvironment.ensureSharedScaffold({
          environment,
          session,
        })
        await CyberEnvironment.ensureSubagentWorkspace({
          environment,
          session,
        })
      }
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      const envBlock =
        environment?.type === "cyber"
          ? [
              "<system-reminder>",
              "CYBER SUBAGENT WORKSPACE CONTEXT",
              `environment.root=${environment.root}`,
              `finding.md=${CyberEnvironment.resolveFindingPath(session)}`,
              `handoff.md=${path.join(environment.root, "handoff.md")}`,
              `results.md=${path.join(environment.root, "agents", session.id, "results.md")}`,
              "IMPORTANT: Paths include spaces on this host. Always wrap absolute paths in double quotes in shell commands.",
              `Example: ls -la "${environment.root}"`,
              "Do not overlap scope with parallel subagents.",
              "Continuously update findings.md through the finding tool when validated.",
              "Append handoff notes before finishing.",
              "Write a concise completion summary to results.md before ending.",
              "MANDATORY: End results.md with this compact section template:",
              "## Structured Summary",
              "- executed_commands: [list commands actually run]",
              "- generated_files: [list artifact paths created or updated]",
              "- unverified_claims: [list claims not validated with direct evidence, or []]",
              "- failed_commands: [list command + reason, including permission denials/root requirements, or []]",
              "For assess runs: classify findings as validated vs hypothesis; only validated findings should carry high confidence.",
              "If a command partially fails (permission denied, requires root, timeout), record it explicitly in failed_commands and adjust confidence.",
              "Use command profiles by scope: home/internal => non-destructive recon defaults first, then deeper checks only with explicit operator approval.",
              ...(agent.name === "report_writer"
                ? [
                    "REPORT_WRITER STAGED WORKFLOW IS MANDATORY:",
                    "1) Explore all available engagement artifacts first.",
                    "2) Synthesize findings and create report-plan.md.",
                    "3) Build report-outline.md and report-draft.md in parts.",
                    "4) Produce results.md and remediation-plan.md.",
                    "5) Finalize by calling report_finalize.",
                  ]
                : []),
              "</system-reminder>",
              "",
            ].join("\n")
          : ""
      const promptParts = await SessionPrompt.resolvePromptParts(envBlock + params.prompt)
      const startedAt = new Date().toISOString()
      const swarmFlags = await SwarmTeamManager.flags()
      const team = swarmFlags.enabled
        ? params.team_id
          ? SwarmTeamManager.get(params.team_id)
          : await SwarmTeamManager.ensureDefaultTeam({ sessionID: ctx.sessionID })
        : undefined
      if (params.team_id && !team) throw new Error(`Team not found: ${params.team_id}`)
      if (team) {
        await SwarmTmux.ensureSession({ teamID: team.id }).catch(() => undefined)
        SwarmTeamManager.upsertMember({
          teamID: team.id,
          sessionID: ctx.sessionID,
          agentName: ctx.agent,
          role: "planner",
          state: "running",
        })
        SwarmTeamManager.upsertMember({
          teamID: team.id,
          sessionID: session.id,
          agentName: agent.name,
          role: "worker",
          state: "ready",
        })
      }
      const existingCallerChain = SwarmIdentity.normalize(
        (ctx.extra?.["caller_chain"] as unknown) ?? (ctx.extra?.["callerChain"] as unknown),
      )
      const callerChain = SwarmIdentity.build({
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        callerID: params.caller_id,
        existing: existingCallerChain,
      })
      const callerId = callerChain.at(-1)?.callerId ?? params.caller_id ?? `caller_${ctx.sessionID}`
      const delegationDepth = SwarmIdentity.depth(callerChain)
      const delegationMode = params.delegation_mode ?? "direct"
      const isolationMode = params.isolation_mode ?? "shared"
      const retryPolicy = params.retry_policy ?? "none"
      const sessionWithEnvironment = environment ? ({ ...session, environment } as Session.Info) : session
      let claimedScopes: string[] = []
      let swarmClaimIDs: string[] = []
      let wroteLegacyCoordination = false
      if (params.coordination_scope?.length) {
        if (team) {
          const claim = SwarmTeamManager.claimScopes({
            teamID: team.id,
            ownerSessionID: session.id,
            scopes: params.coordination_scope,
            allowOverlap: params.allow_scope_overlap,
            metadata: {
              agent: agent.name,
              parent_session_id: ctx.sessionID,
            },
          })
          if (claim.blocked.length > 0) {
            throw new Error(`Coordination scope already claimed: ${claim.blocked.join(", ")}`)
          }
          swarmClaimIDs = claim.claims
          claimedScopes = [...params.coordination_scope]
          await SwarmInbox.send({
            teamID: team.id,
            type: SwarmInbox.MessageType.ClaimGranted,
            fromSessionID: ctx.sessionID,
            toSessionID: session.id,
            payload: {
              claim_ids: swarmClaimIDs,
              scope: claimedScopes,
              subagent_type: agent.name,
            },
            dualWriteSessionID: ctx.sessionID,
          })
        }
        if (environment?.type === "cyber" && (!swarmFlags.enabled || swarmFlags.dualWriteLegacyFiles)) {
          const claim = await CyberEnvironment.claimCoordinationScope({
            session: sessionWithEnvironment,
            ownerSessionID: session.id,
            scopes: params.coordination_scope,
            allowOverlap: params.allow_scope_overlap,
          })
          if (claim.blocked.length > 0) {
            if (team && claimedScopes.length > 0) {
              SwarmTeamManager.releaseClaims({
                ownerSessionID: session.id,
                scopes: claimedScopes,
                status: "released",
              })
            }
            throw new Error(`Coordination scope already claimed: ${claim.blocked.join(", ")}`)
          }
          wroteLegacyCoordination = true
          claimedScopes = claim.claimed
          await CyberEnvironment.appendCoordinationInbox({
            session: sessionWithEnvironment,
            ownerSessionID: session.id,
            payload: {
              type: "scope_claimed",
              scope: claimedScopes,
              subagent_type: agent.name,
            },
          })
        }
      }
      if (team) {
        if (delegationMode === "direct") {
          await SwarmMeshRouter.delegation({
            teamID: team.id,
            fromSessionID: ctx.sessionID,
            toSessionID: session.id,
            fromAgent: ctx.agent,
            callerID: params.caller_id,
            callerChain,
            metadata: {
              expected_output_schema: params.expected_output_schema ?? "brief",
              teammate_targets: params.teammate_targets ?? [],
              coordination_scope: params.coordination_scope ?? [],
            },
            dualWriteSessionID: ctx.sessionID,
          })
        } else {
          await SwarmInbox.send({
            teamID: team.id,
            type: SwarmInbox.MessageType.TaskOffer,
            fromSessionID: ctx.sessionID,
            toSessionID: session.id,
            payload: {
              caller_chain: callerChain,
              delegation_depth: delegationDepth,
              expected_output_schema: params.expected_output_schema ?? "brief",
              teammate_targets: params.teammate_targets ?? [],
              coordination_scope: params.coordination_scope ?? [],
            },
            dualWriteSessionID: ctx.sessionID,
          })
        }
      }
      const telemetryBase = {
        sessionId: session.id,
        parentSessionId: ctx.sessionID,
        teamId: team?.id ?? "",
        callerId,
        callerChain,
        delegationDepth,
        delegationMode,
        isolationMode,
        retryPolicy,
        claimIds: swarmClaimIDs,
        agent: agent.name,
        model,
        startedAt,
        expectedOutputSchema: params.expected_output_schema ?? "brief",
        coordinationScope: params.coordination_scope ?? [],
        teammateTargets: params.teammate_targets ?? [],
      }
      const telemetryDefaults = {
        backgroundTaskId: "",
        endedAt: "",
        durationMs: 0,
        errorType: "",
      }

      ctx.metadata({
        title: params.description,
        metadata: {
          ...telemetryBase,
          ...telemetryDefaults,
          status: params.run_in_background ? "queued" : "running",
        },
      })

      const executeSubagent = async (signal: AbortSignal, touch?: () => void) => {
        const messageID = Identifier.ascending("message")
        const runStartedAt = Date.now()
        const cancel = () => SessionPrompt.cancel(session.id)
        signal.addEventListener("abort", cancel, { once: true })
        try {
          touch?.()
          const recoveryAbort = new AbortController()
          const cancelRecovery = () => recoveryAbort.abort()
          signal.addEventListener("abort", cancelRecovery, { once: true })
          const promptResult = SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            tools: {
              todowrite: false,
              todoread: false,
              ...(hasTaskPermission ? {} : { task: false }),
              ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
            },
            parts: promptParts,
          })
          promptResult.finally(() => recoveryAbort.abort()).catch(() => {})
          const result = (await Promise.race([
            promptResult,
            waitForTerminalAssistant({
              sessionID: session.id,
              startedAt: runStartedAt,
              abort: recoveryAbort.signal,
            }),
          ])) as MessageV2.WithParts | undefined
          signal.removeEventListener("abort", cancelRecovery)
          const finalResult = result ?? ((await promptResult) as MessageV2.WithParts)
          touch?.()
          const text = finalResult.parts.findLast((x) => x.type === "text")?.text ?? ""
          if (environment?.type === "cyber") {
            const denial = /prevents you from using this specific tool call|permission[^.\n]*deny/i.test(text)
            if (denial) {
              const handoffPath = path.join(environment.root, "handoff.md")
              const resultsPath = path.join(environment.root, "agents", session.id, "results.md")
              const warning = [
                "",
                "## Runtime Warning",
                `- timestamp: ${new Date().toISOString()}`,
                `- subagent: ${agent.name}`,
                "- issue: Permission denial encountered during execution",
                "- impact: Some planned artifact updates or checks may be incomplete",
                "- action: Review failed_commands and rerun with adjusted permissions/scope if needed",
                "",
              ].join("\n")
              await Promise.all([
                fs.appendFile(handoffPath, warning).catch(() => {}),
                fs.appendFile(resultsPath, warning).catch(() => {}),
              ])
            }
          }
          const assistant = finalResult.info as MessageV2.Assistant
          if (assistant.error) {
            const errorMessage =
              typeof assistant.error?.data === "object" &&
              assistant.error?.data &&
              "message" in assistant.error.data &&
              typeof assistant.error.data.message === "string"
                ? assistant.error.data.message
                : "unknown error"
            throw new Error(
              `Subagent ${agent.name} failed: ${assistant.error.name}: ${errorMessage}`,
            )
          }
          return text
        } finally {
          signal.removeEventListener("abort", cancel)
        }
      }

      const finalizeScope = async (status: "completed" | "failed" | "released") => {
        if (team && claimedScopes.length > 0) {
          SwarmTeamManager.releaseClaims({
            ownerSessionID: session.id,
            scopes: claimedScopes,
            status,
          })
          await SwarmInbox.send({
            teamID: team.id,
            type:
              status === "completed"
                ? SwarmInbox.MessageType.Completion
                : status === "failed"
                  ? SwarmInbox.MessageType.Failure
                  : SwarmInbox.MessageType.Handoff,
            fromSessionID: session.id,
            toSessionID: ctx.sessionID,
            payload: {
              scope: claimedScopes,
              claim_ids: swarmClaimIDs,
              subagent_type: agent.name,
              status,
            },
            dualWriteSessionID: ctx.sessionID,
          })
        }
        if (!wroteLegacyCoordination || environment?.type !== "cyber" || !claimedScopes.length) return
        await CyberEnvironment.releaseCoordinationScope({
          session: sessionWithEnvironment,
          ownerSessionID: session.id,
          scopes: claimedScopes,
          status,
        })
        await CyberEnvironment.appendCoordinationInbox({
          session: sessionWithEnvironment,
          ownerSessionID: session.id,
          payload: {
            type: `scope_${status}`,
            scope: claimedScopes,
            subagent_type: agent.name,
          },
        })
      }

      if (params.run_in_background) {
        const task = await BackgroundAgentManager.start({
          description: params.description,
          prompt: params.prompt,
          subagentType: params.subagent_type,
          parentSessionID: ctx.sessionID,
          sessionID: session.id,
          providerID: model.providerID,
          modelID: model.modelID,
          teammateTargets: params.teammate_targets,
          coordinationScope: params.coordination_scope,
          expectedOutputSchema: params.expected_output_schema,
          teamID: team?.id,
          callerID: callerId,
          callerChain,
          delegationDepth,
          isolationMode,
          retryPolicy,
          claimIds: swarmClaimIDs,
          cancel: () => SessionPrompt.cancel(session.id),
          run: async ({ signal, touch }) => {
            try {
              const text = await executeSubagent(signal, touch)
              await finalizeScope("completed")
              return { output: text }
            } catch (error) {
              await finalizeScope("failed")
              throw error
            }
          },
        })
        return {
          title: params.description,
          metadata: {
            ...telemetryBase,
            ...telemetryDefaults,
            backgroundTaskId: task.id,
            status: "queued",
          },
          output: [
            `task_id: ${session.id} (subagent session)`,
            `background_task_id: ${task.id}`,
            "",
            "Background task queued. Use background_list/background_output/background_cancel tools to manage it.",
          ].join("\n"),
        }
      }

      try {
        const text = await executeSubagent(ctx.abort)
        await finalizeScope("completed")
        const endedAt = new Date().toISOString()
        const output = [
          `task_id: ${session.id} (for resuming to continue this task if needed)`,
          "",
          "<task_result>",
          text,
          "</task_result>",
        ].join("\n")
        return {
          title: params.description,
          metadata: {
            ...telemetryBase,
            ...telemetryDefaults,
            status: "completed",
            endedAt,
            durationMs: Date.parse(endedAt) - Date.parse(startedAt),
            errorType: "",
          },
          output,
        }
      } catch (error) {
        await finalizeScope("failed")
        const endedAt = new Date().toISOString()
        ctx.metadata({
          title: params.description,
          metadata: {
            ...telemetryBase,
            ...telemetryDefaults,
            status: "failed",
            endedAt,
            durationMs: Date.parse(endedAt) - Date.parse(startedAt),
            errorType: error instanceof Error ? error.name : "Error",
          },
        })
        throw error
      }
    },
  }
})
