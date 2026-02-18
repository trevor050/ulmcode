import { Tool } from "./tool"
import z from "zod"
import { BackgroundAgentManager } from "@/features/background-agent/manager"
import { Session } from "@/session"
import { CyberEnvironment } from "@/session/environment"

const parameters = z.object({
  task_id: z.string(),
})

export const BackgroundCancelTool = Tool.define("background_cancel", {
  description: "Cancel a queued or running background task.",
  parameters,
  async execute(params) {
    const task = await BackgroundAgentManager.cancel(params.task_id)
    if (!task) throw new Error(`Background task not found: ${params.task_id}`)
    const session = await Session.get(task.sessionID).catch(() => undefined)
    if (session?.environment?.type === "cyber" && task.coordinationScope.length > 0) {
      await CyberEnvironment.releaseCoordinationScope({
        session,
        ownerSessionID: task.sessionID,
        scopes: task.coordinationScope,
        status: "released",
      })
      await CyberEnvironment.appendCoordinationInbox({
        session,
        ownerSessionID: task.sessionID,
        payload: {
          type: "scope_released",
          scope: task.coordinationScope,
          reason: "background_cancel",
        },
      })
    }
    return {
      title: `Cancelled ${task.id}`,
      metadata: task,
      output: `Cancelled background task ${task.id} (${task.subagentType})`,
    }
  },
})
