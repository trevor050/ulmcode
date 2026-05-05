import * as Tool from "./tool"
import DESCRIPTION from "./task_list.txt"
import { BackgroundJob } from "@/background/job"
import { Effect, Schema } from "effect"

export const Parameters = Schema.Struct({
  status: Schema.optional(Schema.Literals(["running", "completed", "error", "cancelled", "stale"])),
  operationID: Schema.optional(Schema.String),
})

type Metadata = {
  count: number
}

export const TaskListTool = Tool.define<typeof Parameters, Metadata, BackgroundJob.Service>(
  "task_list",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const items = (yield* jobs.list()).filter((job) => {
            if (params.status && job.status !== params.status) return false
            if (params.operationID && job.metadata?.operationID !== params.operationID) return false
            return true
          })
          return {
            title: `${items.length} background task${items.length === 1 ? "" : "s"}`,
            output: items.length
              ? items
                  .map((job) =>
                    [
                      `task_id: ${job.id}`,
                      `type: ${job.type}`,
                      `status: ${job.status}`,
                      ...(typeof job.metadata?.operationID === "string" ? [`operation_id: ${job.metadata.operationID}`] : []),
                      ...(job.status === "stale" && typeof job.metadata?.prompt === "string" ? ["restartable: true"] : []),
                      ...(job.title ? [`title: ${job.title}`] : []),
                      ...(job.completedAt ? [`completed_at: ${new Date(job.completedAt).toISOString()}`] : []),
                    ].join("\n"),
                  )
                  .join("\n\n")
              : "No background tasks found.",
            metadata: {
              count: items.length,
            },
          }
        }),
    }
  }),
)
