import { Tool } from "./tool"
import z from "zod"
import { BackgroundAgentManager } from "@/features/background-agent/manager"

const parameters = z.object({
  parent_session_id: z.string().optional(),
  include_completed: z.boolean().default(true),
})

export const BackgroundListTool = Tool.define("background_list", {
  description: "List background subagent tasks and their status.",
  parameters,
  async execute(params) {
    const tasks = await BackgroundAgentManager.list({
      parentSessionID: params.parent_session_id,
      includeCompleted: params.include_completed,
    })
    const rows = tasks.map((task) =>
      [
        `id=${task.id}`,
        `status=${task.status}`,
        `team_id=${task.teamId ?? "n/a"}`,
        `caller_id=${task.callerId ?? "n/a"}`,
        `delegation_depth=${task.delegationDepth}`,
        `subagent=${task.subagentType}`,
        `parent_session=${task.parentSessionID}`,
        `session=${task.sessionID}`,
        `isolation_mode=${task.isolationMode}`,
        `retry_count=${task.retryCount}`,
        `scheduler_lane=${task.schedulerLane}`,
        `claim_ids=${task.claimIds.join(",")}`,
        `duration_ms=${task.durationMs ?? 0}`,
      ].join(" "),
    )
    return {
      title: "Background tasks",
      metadata: {
        count: tasks.length,
        tasks,
      },
      output: rows.length ? rows.join("\n") : "No background tasks found.",
    }
  },
})
