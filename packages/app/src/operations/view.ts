import type { OperationRecord, OperationStatus, PhaseStatus } from "@ulmcode/operations/operation"

export function operationStatusKey(status: OperationStatus) {
  return `ulm.operations.status.${status}` as const
}

export function phaseStatusKey(status: PhaseStatus) {
  return `ulm.operations.phase.${status}` as const
}

export function executionStatusKey(status: "intent" | "running" | "succeeded" | "failed" | "interrupted" | "unknown") {
  return `ulm.operations.execution.${status}` as const
}

export function operationTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

export function operationSort(items: OperationRecord[]) {
  const priority: Record<OperationStatus, number> = {
    blocked: 0,
    running: 1,
    failed: 2,
    interrupted: 3,
    draft: 4,
    planned: 5,
    completed: 6,
  }

  return items.slice().sort((a, b) => priority[a.status] - priority[b.status] || b.updatedAt.localeCompare(a.updatedAt))
}

export function artifactURLPath(path: string) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/")
}

export function operationSessionLabel(operation: OperationRecord) {
  return operation.sessionIDs.length ? operation.sessionIDs.join(", ") : "operator-local"
}
