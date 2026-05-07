import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"
import { superviseOperation } from "./operation-supervisor"
import type { OperationGoalRecord } from "./operation-goal"
import type { ULMRuntimeConfig } from "./config"

export type OperatorTimeoutKind = "permission" | "question"

export type OperatorTimeoutRecord = {
  operationID: string
  kind: OperatorTimeoutKind
  requestID: string
  sessionID: string
  timedOutAt: string
  fallback: string
  prompt?: string
  sensitive: boolean
}

const sensitivePatterns = [
  "authorization",
  "authorize",
  "credential",
  "password",
  "scope",
  "expand",
  "destructive",
  "privacy",
  "private",
  "install",
  "download",
  "secret",
  "token",
]

export function operatorFallbackTimeoutMillis(goal: OperationGoalRecord, config: ULMRuntimeConfig = {}) {
  if (config.operator_timeout_seconds === 0) return undefined
  return Math.max(1, Math.round((config.operator_timeout_seconds ?? goal.continuation?.operatorFallbackTimeoutSeconds ?? 75) * 1000))
}

export function isSensitiveOperatorPrompt(text: string) {
  const lower = text.toLowerCase()
  return sensitivePatterns.some((pattern) => lower.includes(pattern))
}

export async function recordOperatorTimeout(
  worktree: string,
  input: Omit<OperatorTimeoutRecord, "timedOutAt"> & { timedOutAt?: string },
) {
  const record: OperatorTimeoutRecord = {
    ...input,
    operationID: slug(input.operationID, "operation"),
    timedOutAt: input.timedOutAt ?? new Date().toISOString(),
  }
  const dir = path.join(operationPath(worktree, record.operationID), "operator-timeouts")
  const file = path.join(
    dir,
    `${record.timedOutAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "")}-${record.kind}-${record.requestID}.json`,
  )
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, JSON.stringify({ ...record, file }, null, 2) + "\n")
  await superviseOperation(worktree, {
    operationID: record.operationID,
    reviewKind: "operator_timeout",
    maxActions: 1,
    latestAssistantMessage: `${record.kind} timeout fallback: ${record.fallback}`,
  })
  return { ...record, file }
}
