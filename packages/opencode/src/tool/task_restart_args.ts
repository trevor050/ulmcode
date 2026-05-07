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
    laneID: stringMetadata(job, "laneID"),
    modelRoute: stringMetadata(job, "modelRoute"),
    command: stringMetadata(job, "command"),
  }
}

function stringRecordMetadata(job: BackgroundJob.Info, key: string) {
  const value = job.metadata?.[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return Object.fromEntries(entries)
}

export function commandRestartArgs(job: BackgroundJob.Info) {
  if (job.type !== "command_supervise") return undefined
  const operationID = stringMetadata(job, "operationID")
  const profileID = stringMetadata(job, "profileID")
  if (!operationID || !profileID) return undefined
  return {
    operationID,
    laneID: stringMetadata(job, "laneID"),
    workUnitID: stringMetadata(job, "workUnitID"),
    profileID,
    variables: stringRecordMetadata(job, "variables"),
    outputPrefix: stringMetadata(job, "outputPrefix"),
    manifestPath: stringMetadata(job, "manifestPath"),
    worktree: stringMetadata(job, "worktree"),
    dryRun: false,
  }
}
