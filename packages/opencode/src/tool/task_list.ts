import * as Tool from "./tool"
import DESCRIPTION from "./task_list.txt"
import { BackgroundJob } from "@/background/job"
import { Effect, Schema } from "effect"

export const Parameters = Schema.Struct({
  status: Schema.optional(Schema.Literals(["running", "completed", "error", "cancelled", "stale"])),
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
          const items = (yield* jobs.list()).filter((job) => !params.status || job.status === params.status)
          return {
            title: `${items.length} background task${items.length === 1 ? "" : "s"}`,
            output: items.length
              ? items
                  .map((job) =>
                    [
                      `task_id: ${job.id}`,
                      `type: ${job.type}`,
                      `status: ${job.status}`,
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
