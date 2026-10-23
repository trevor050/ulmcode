import { createHash } from "node:crypto"

export type OperationStatus = "draft" | "planned" | "running" | "interrupted" | "blocked" | "completed" | "failed"
export type PhaseStatus = "pending" | "ready" | "running" | "blocked" | "skipped" | "complete" | "failed"
export type ExecutionStatus = "intent" | "running" | "succeeded" | "failed" | "interrupted" | "unknown"
export type RestartPolicy = "safe" | "inspect_first" | "never"
export type GoalVerdict = "continue" | "done" | "needs_operator"

export type ArtifactRef = {
  path: string
  mediaType?: string
  sha256?: string
  size?: number
}

export type OperationCommandSpec = {
  profileID: string
  /** Non-secret, bounded values accepted by a trusted command catalog entry. */
  variables: Record<string, string>
  /** Opaque vault handles; secret values are materialized only at spawn time. */
  credentialHandles?: string[]
}

export type OperationPhase = {
  id: string
  title: string
  dependsOn: string[]
  successCriteria: string[]
  status: PhaseStatus
  restart: RestartPolicy
  required: boolean
  expectedArtifacts: string[]
  command?: OperationCommandSpec
}

export type OperationPlan = {
  version: number
  approvedAt?: string
  approvedBy?: string
  assumptions: string[]
  successCriteria: string[]
  phases: OperationPhase[]
  reporting: { required: boolean; renderer?: string }
}

export type CompletionGate =
  | "plan_approved"
  | "required_phases_complete"
  | "evidence_normalized"
  | "runtime_summary"
  | "report_manifest"
  | "audit_passed"
  | "stage_gate"

export type OperationGoal = {
  status: "active" | "complete"
  startedAt: string
  targetDurationMs?: number
  continuation: { enabled: boolean; maxNoToolTurns: number; noToolStreak: number }
  gates: CompletionGate[]
  review?: { verdict: GoalVerdict; at: string; reason?: string }
  completion?: { checkedAt: string; blockers: string[] }
}

export type OperationExecution = {
  id: string
  phaseID: string
  adapter: string
  idempotencyKey: string
  receipt?: string
  status: ExecutionStatus
  attempt: number
  createdAt: string
  startedAt?: string
  updatedAt: string
  endedAt?: string
  checkpointRef?: string
  artifactRefs: ArtifactRef[]
  errorSummary?: string
}

export type EvidenceClaim = {
  id: string
  kind: string
  subject?: string
  summary: string
  confidence?: number
  source: ArtifactRef
}

export type NormalizedEvidence = {
  operationID: string
  normalizedAt: string
  normalizerVersion: string
  artifacts: ArtifactRef[]
  claims: EvidenceClaim[]
  limitations: string[]
}

export type SubordinateHandoff = {
  id: string
  phaseID: string
  childID: string
  createdAt: string
  status: "offered" | "accepted" | "completed" | "rejected"
  allowedArtifactPrefix: string
  artifactRefs: ArtifactRef[]
}

export type OperationRecord = {
  schemaVersion: 1
  id: string
  revision: number
  createdAt: string
  updatedAt: string
  status: OperationStatus
  objective: string
  sessionIDs: string[]
  scope: { targets: string[]; mode: "synthetic_lab" | "authorized"; authorizationRef?: string }
  plan?: OperationPlan
  goal: OperationGoal
  executions: OperationExecution[]
  artifacts: ArtifactRef[]
  evidence?: NormalizedEvidence
  reportSourceRevision?: number
  reportSourceDigest?: string
  handoffs: SubordinateHandoff[]
  audit?: { status: "passed" | "blocked"; checkedAt: string; blockers: string[]; recordRevision: number }
  lastError?: { code: string; message: string; at: string }
}

export type OperationEvent = {
  operationID: string
  seq: number
  revision: number
  at: string
  type: string
  idempotencyKey: string
  actor: { kind: "operator" | "engine" | "adapter"; id?: string }
  data: unknown
}

export type OperationCreateInput = {
  id?: string
  sessionID: string
  objective: string
  scope: OperationRecord["scope"]
  plan?: Omit<OperationPlan, "version" | "approvedAt" | "approvedBy" | "phases"> & {
    phases: Array<Omit<OperationPhase, "status"> & { status?: PhaseStatus }>
  }
  goal?: Partial<Pick<OperationGoal, "targetDurationMs" | "gates">> & {
    continuation?: Partial<OperationGoal["continuation"]>
  }
}

export type Approval = { approvedBy: string; at?: string }

export type ExecutionObservation = {
  status: "running" | "succeeded" | "failed" | "interrupted" | "unknown"
  checkpointRef?: string
  artifactRefs: ArtifactRef[]
  summary?: string
}

export type LaunchRequest = {
  operationID: string
  executionID: string
  phase: OperationPhase
  idempotencyKey: string
  attempt: number
  artifactDirectory: string
  scope: OperationRecord["scope"]
}

export interface ExecutionAdapter {
  readonly id: string
  validatePhase?(request: LaunchRequest): void
  receipt(request: LaunchRequest): string
  launch(request: LaunchRequest): Promise<{ receipt: string }>
  inspect(receipt: string): Promise<ExecutionObservation>
  interrupt(receipt?: string, request?: LaunchRequest): Promise<void>
  recover(request: LaunchRequest, receipt?: string): Promise<{ receipt: string } | undefined>
}

export type SchedulerDecision =
  | { action: "launch"; request: LaunchRequest; receipt?: string; operation: OperationRecord }
  | { action: "wait"; reason: string; operation: OperationRecord }
  | { action: "blocked"; blockers: string[]; operation: OperationRecord }
  | { action: "complete"; operation: OperationRecord }
  | { action: "expand"; reason: string; operation: OperationRecord }

export type GoalCompletionResult = { completed: boolean; blockers: string[]; operation: OperationRecord }
export type GoalReviewResult = { operation: OperationRecord; continuation: "continue" | "operator_required" | "complete"; blockers: string[] }

export type RecoverySummary = {
  operation: OperationRecord
  recovered: string[]
  waiting: string[]
  blockers: string[]
}

export type StoreCommitInput = {
  operationID: string
  expectedRevision: number
  type: string
  idempotencyKey: string
  actor: OperationEvent["actor"]
  data: unknown
  operation: OperationRecord
}

export type StoreCommitResult = { operation: OperationRecord; replayed: boolean }

export function operationID(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(normalized)) throw new Error("operation id must be a safe path component")
  return normalized
}

export function sessionID(value: string) {
  const normalized = value.trim()
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f]/.test(normalized)) throw new Error("session id is invalid")
  return normalized
}

export function operationSourceDigest(record: OperationRecord) {
  const source = {
    schemaVersion: record.schemaVersion,
    id: record.id,
    objective: record.objective,
    scope: record.scope,
    plan: record.plan,
    goal: {
      targetDurationMs: record.goal.targetDurationMs,
      gates: record.goal.gates,
    },
    evidence: record.evidence,
    artifacts: record.artifacts
      .filter((artifact) => !artifact.path.startsWith("deliverables/final/"))
      .toSorted((a, b) => a.path.localeCompare(b.path)),
    executions: record.executions.map((execution) => ({
      id: execution.id,
      phaseID: execution.phaseID,
      adapter: execution.adapter,
      status: execution.status,
      attempt: execution.attempt,
      artifactRefs: execution.artifactRefs,
      errorSummary: execution.errorSummary,
    })),
  }
  return createHash("sha256").update(JSON.stringify(source)).digest("hex")
}
