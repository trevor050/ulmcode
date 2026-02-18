import { Tool } from "./tool"
import z from "zod"
import { BackgroundAgentManager } from "@/features/background-agent/manager"

const parameters = z.object({
  task_id: z.string(),
})

export const BackgroundOutputTool = Tool.define("background_output", {
  description: "Read output and metadata for a background task.",
  parameters,
  async execute(params) {
    const task = await BackgroundAgentManager.get(params.task_id)
    if (!task) throw new Error(`Background task not found: ${params.task_id}`)
    const output = [
      `id: ${task.id}`,
      `status: ${task.status}`,
      `team_id: ${task.teamId ?? "n/a"}`,
      `caller_id: ${task.callerId ?? "n/a"}`,
      `caller_chain: ${JSON.stringify(task.callerChain)}`,
      `delegation_depth: ${task.delegationDepth}`,
      `subagent: ${task.subagentType}`,
      `parent_session: ${task.parentSessionID}`,
      `session: ${task.sessionID}`,
      `swarm_aggression: ${task.swarmAggression}`,
      `aggression_source: ${task.aggressionSource}`,
      `max_active_background: ${task.maxActiveBackground ?? "unbounded"}`,
      `max_delegation_depth: ${task.maxDelegationDepth}`,
      `isolation_mode: ${task.isolationMode}`,
      `retry_count: ${task.retryCount}`,
      `scheduler_lane: ${task.schedulerLane}`,
      `claim_ids: ${task.claimIds.join(",")}`,
      `started_at: ${task.startedAt ? new Date(task.startedAt).toISOString() : "n/a"}`,
      `ended_at: ${task.endedAt ? new Date(task.endedAt).toISOString() : "n/a"}`,
      `duration_ms: ${task.durationMs ?? 0}`,
      ...(task.error ? [`error: ${task.error}`] : []),
      "",
      "<task_result>",
      task.output ?? "",
      "</task_result>",
    ].join("\n")
    return {
      title: `Background output ${task.id}`,
      metadata: task,
      output,
    }
  },
})
