import type { BackgroundJob } from "@/background/job"

function stringMetadata(job: BackgroundJob.Info, key: string) {
  const value = job.metadata?.[key]
  return typeof value === "string" && value ? value : undefined
}

export function taskRestartArgs(job: BackgroundJob.Info) {
  const prompt = stringMetadata(job, "prompt")
  const subagentType = stringMetadata(job, "subagent_type")
  const description = stringMetadata(job, "description") ?? job.title
  if (!prompt || !subagentType || !description) return undefined
  return {
    task_id: job.id,
    background: true,
    description,
    prompt,
    subagent_type: subagentType,
    operationID: stringMetadata(job, "operationID"),
    command: stringMetadata(job, "command"),
  }
}
