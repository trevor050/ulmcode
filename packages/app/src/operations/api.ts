import type {
  GoalVerdict,
  OperationCreateInput,
  OperationRecord,
  RecoverySummary,
  SchedulerDecision,
} from "@ulmcode/operations/operation"
import type { CredentialMetadata } from "@ulmcode/operations/credentials"

export type CredentialStatusResponse = {
  credentials: CredentialMetadata[]
  reviewStatus: { submitted: boolean; reviewed: number; pending: number; requiresReauth: number }
}

export class OperationApiError extends Error {
  readonly code: string | undefined
  readonly status: number

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "OperationApiError"
    this.status = status
    this.code = code
  }
}

export const operationsApiBase = (import.meta.env.VITE_ULMCODE_API_URL || "http://127.0.0.1:4310").replace(/\/$/, "")

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${operationsApiBase}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  const payload = await response.json().catch(() => undefined)

  if (!response.ok) {
    const error = payload && typeof payload === "object" ? (payload as { error?: { code?: string; message?: string } }).error : undefined
    throw new OperationApiError(
      error?.message || `Operation service returned ${response.status}`,
      response.status,
      error?.code,
    )
  }

  return payload as T
}

export const operationApi = {
  list: () => request<{ operations: OperationRecord[] }>("/api/operations"),
  credentials: (id: string) =>
    request<CredentialStatusResponse>(`/api/operations/${encodeURIComponent(id)}/credentials`),
  get: (id: string) => request<{ operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}`),
  create: (input: OperationCreateInput) =>
    request<{ operation: OperationRecord }>("/api/operations", { method: "POST", body: JSON.stringify(input) }),
  bind: (id: string, sessionID: string) =>
    request<{ operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}/bind`, {
      method: "POST",
      body: JSON.stringify({ sessionID }),
    }),
  approve: (id: string, approvedBy: string) =>
    request<{ operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvedBy }),
    }),
  run: (id: string) =>
    request<{ decision: SchedulerDecision; operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  interrupt: (id: string, reason: string) =>
    request<{ operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}/interrupt`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  recover: (id: string) =>
    request<{ recovery: RecoverySummary; operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}/recover`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  normalize: (id: string) =>
    request<{ operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}/normalize`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  reviewGoal: (id: string, verdict: GoalVerdict, reason?: string) =>
    request<{ result: unknown; operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}/review-goal`, {
      method: "POST",
      body: JSON.stringify({ verdict, reason }),
    }),
  report: (id: string) =>
    request<{ report: unknown; operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}/report`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  artifactURL: (id: string, path: string) =>
    `${operationsApiBase}/api/operations/${encodeURIComponent(id)}/artifacts/${path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`,
  vaultURL: (id: string) => `${operationsApiBase}/api/operations/${encodeURIComponent(id)}/vault`,
}
