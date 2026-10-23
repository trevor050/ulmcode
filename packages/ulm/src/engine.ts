import { createHash, randomUUID } from "node:crypto"
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { normalizeEvidence } from "./evidence"
import { findingDocumentSchema, recordFindingsInputSchema, type RecordFindingsInput } from "./findings"
import { applyCompletionGate, completionBlockers, DEFAULT_COMPLETION_GATES, recordGoalReview } from "./goal"
import {
  operationID,
  operationSourceDigest,
  type Approval,
  type ArtifactRef,
  type ExecutionAdapter,
  type ExecutionObservation,
  type GoalCompletionResult,
  type GoalReviewResult,
  type GoalVerdict,
  type LaunchRequest,
  type OperationCreateInput,
  type OperationExecution,
  type OperationPhase,
  type OperationRecord,
  type RecoverySummary,
  type SchedulerDecision,
  type SubordinateHandoff,
} from "./operation"
import { OperationConflictError, OperationStore } from "./store"

function fileRef(root: string, reference: ArtifactRef) {
  if (path.isAbsolute(reference.path)) throw new Error(`artifact path must be relative: ${reference.path}`)
  const file = path.resolve(root, reference.path)
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`artifact path escapes operation: ${reference.path}`)
  if (lstatSync(file).isSymbolicLink()) throw new Error(`artifact path cannot be a symbolic link: ${reference.path}`)
  const realRoot = realpathSync(root)
  const realFile = realpathSync(file)
  const realRelative = path.relative(realRoot, realFile)
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error(`artifact path resolves outside operation: ${reference.path}`)
  const bytes = readFileSync(realFile)
  return {
    path: realRelative.split(path.sep).join("/"),
    mediaType: reference.mediaType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  } satisfies ArtifactRef
}

function validatePlan(input: OperationCreateInput["plan"]) {
  if (!input) return undefined
  if (!input.phases.length) throw new Error("an operation plan must contain at least one phase")
  const ids = new Set(input.phases.map((phase) => phase.id))
  if (ids.size !== input.phases.length || input.phases.some((phase) => !phase.id.trim())) throw new Error("operation phase ids must be unique and non-empty")
  for (const phase of input.phases) {
    if (phase.dependsOn.includes(phase.id)) throw new Error(`phase ${phase.id} cannot depend on itself`)
    for (const dependency of phase.dependsOn) if (!ids.has(dependency)) throw new Error(`phase ${phase.id} has unknown dependency ${dependency}`)
    if (phase.command) {
      const command = phase.command
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(command.profileID)) throw new Error(`phase ${phase.id} has an invalid command profileID`)
      if (!command.variables || typeof command.variables !== "object" || Array.isArray(command.variables) || Object.keys(command.variables).length > 100) {
        throw new Error(`phase ${phase.id} has invalid command variables`)
      }
      for (const [name, value] of Object.entries(command.variables)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) || /(password|passwd|secret|token|api[_-]?key|credential)/i.test(name)) {
          throw new Error(`phase ${phase.id} has an invalid or secret-shaped command variable name`)
        }
        if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
          throw new Error(`phase ${phase.id} has an invalid command variable value`)
        }
      }
      if (command.credentialHandles && (
        command.credentialHandles.length > 32 ||
        new Set(command.credentialHandles).size !== command.credentialHandles.length ||
        command.credentialHandles.some((handle) => !/^cred_[A-Za-z0-9_-]{1,96}$/.test(handle))
      )) throw new Error(`phase ${phase.id} has invalid credential handles`)
    }
  }
  const pending = new Set(input.phases.map((phase) => phase.id))
  const complete = new Set<string>()
  while (pending.size) {
    const ready = [...pending].filter((id) => input.phases.find((phase) => phase.id === id)?.dependsOn.every((dependency) => complete.has(dependency)))
    if (!ready.length) throw new Error("operation plan contains a dependency cycle")
    for (const id of ready) {
      pending.delete(id)
      complete.add(id)
    }
  }
  return {
    version: 1,
    assumptions: [...input.assumptions],
    successCriteria: [...input.successCriteria],
    phases: input.phases.map((phase) => ({
      ...phase,
      status: phase.dependsOn.length ? ("pending" as const) : ("ready" as const),
      required: phase.required ?? true,
      expectedArtifacts: [...phase.expectedArtifacts],
      command: phase.command
        ? {
            ...phase.command,
            variables: { ...phase.command.variables },
            credentialHandles: phase.command.credentialHandles ? [...phase.command.credentialHandles] : undefined,
          }
        : undefined,
    })),
    reporting: { ...input.reporting },
  }
}

function phaseReady(record: OperationRecord, phase: OperationPhase) {
  return phase.status === "ready" && phase.dependsOn.every((id) => record.plan?.phases.find((candidate) => candidate.id === id)?.status === "complete")
}

function withPhase(record: OperationRecord, phaseID: string, update: (phase: OperationPhase) => OperationPhase): OperationRecord {
  if (!record.plan) throw new Error("operation plan is missing")
  return { ...record, plan: { ...record.plan, phases: record.plan.phases.map((phase) => phase.id === phaseID ? update(phase) : phase) } }
}

function uniqueArtifacts(items: ArtifactRef[]) {
  return [...new Map(items.map((item) => [item.path, item])).values()]
}

function planIdentity(plan: NonNullable<OperationRecord["plan"]>) {
  return JSON.stringify({
    assumptions: plan.assumptions,
    successCriteria: plan.successCriteria,
    phases: plan.phases.map(({ id, title, dependsOn, successCriteria, restart, required, expectedArtifacts, command }) => ({
      id,
      title,
      dependsOn,
      successCriteria,
      restart,
      required,
      expectedArtifacts,
      command,
    })),
    reporting: plan.reporting,
  })
}

function operationReady(record: OperationRecord) {
  return record.plan?.phases.filter((phase) => phase.required).every((phase) => phase.status === "complete") ?? false
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined
}

async function withArtifactLock<T>(directory: string, operationID: string, action: () => Promise<T>) {
  const lockFile = path.join(directory, ".artifact-mutation.lock")
  const token = randomUUID()
  let acquired = false
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = openSync(lockFile, "wx", 0o600)
      try {
        writeFileSync(descriptor, JSON.stringify({ operationID, pid: process.pid, token }))
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      acquired = true
      break
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error
      let owner: { pid?: unknown }
      try {
        owner = JSON.parse(readFileSync(lockFile, "utf8")) as { pid?: unknown }
      } catch {
        throw new OperationConflictError(`artifact mutation lock exists but is unreadable for ${operationID}`)
      }
      if (typeof owner.pid !== "number" || processIsAlive(owner.pid)) {
        throw new OperationConflictError(`operation ${operationID} already has an artifact mutation in progress`)
      }
      unlinkSync(lockFile)
    }
  }
  if (!acquired) throw new OperationConflictError(`could not acquire artifact mutation lock for ${operationID}`)
  try {
    return await action()
  } finally {
    try {
      const owner = JSON.parse(readFileSync(lockFile, "utf8")) as { token?: unknown }
      if (owner.token === token) unlinkSync(lockFile)
    } catch {
      // A stale-lock recovery may already have removed the lock.
    }
  }
}

function writeAtomic(file: string, contents: string) {
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, contents, { mode: 0o600 })
  renameSync(temporary, file)
}

function restoreFile(file: string, previous: Buffer | undefined, writtenHash: string) {
  if (!existsSync(file) || createHash("sha256").update(readFileSync(file)).digest("hex") !== writtenHash) return
  if (previous) writeAtomic(file, previous.toString())
  else unlinkSync(file)
}

function ensureRealOperationDirectory(root: string, directory: string) {
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error("artifact directories cannot be symbolic links")
  mkdirSync(directory, { recursive: true })
  const realRoot = realpathSync(root)
  const realDirectory = realpathSync(directory)
  const relative = path.relative(realRoot, realDirectory)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("artifact directory resolves outside the operation")
}

function assertPublicArtifactPath(reference: ArtifactRef) {
  const normalized = reference.path
  if (normalized.includes("\\") || path.posix.normalize(normalized) !== normalized || path.posix.isAbsolute(normalized)) {
    throw new Error("public artifact paths must be normalized relative paths using forward slashes")
  }
  if (
    normalized === "evidence/normalized.json" ||
    normalized.startsWith("findings/") ||
    normalized.startsWith("deliverables/final/")
  ) throw new Error("derived findings, normalized evidence, and final report files have dedicated engine methods")
  if (!["evidence/", "lab/", "commands/", "subagents/"].some((prefix) => normalized.startsWith(prefix))) {
    throw new Error("public artifacts must be under evidence/, lab/, commands/, or subagents/")
  }
}

export class OperationEngine {
  readonly #store: OperationStore
  readonly #adapter: ExecutionAdapter

  constructor(input: { store: OperationStore; workspaceRoot: string; adapter: ExecutionAdapter }) {
    this.#store = input.store
    if (path.resolve(input.workspaceRoot, ".ulmcode", "operations") !== input.store.root) {
      throw new Error("operation store and engine must use the same workspace root")
    }
    this.#adapter = input.adapter
  }

  async create(input: OperationCreateInput): Promise<OperationRecord> {
    const id = operationID(input.id ?? `operation-${randomUUID().slice(0, 12)}`)
    const sessionID = input.sessionID.trim()
    const objective = input.objective.trim()
    if (!sessionID || !objective) throw new Error("sessionID and objective are required")
    if (!Array.isArray(input.scope.targets) || !input.scope.targets.length) throw new Error("at least one scoped target is required")
    if (input.scope.mode === "authorized" && !input.scope.authorizationRef?.trim()) throw new Error("authorized scope requires an opaque authorizationRef")
    if (input.goal?.targetDurationMs !== undefined && (!Number.isFinite(input.goal.targetDurationMs) || input.goal.targetDurationMs < 0)) {
      throw new Error("targetDurationMs must be a finite non-negative number")
    }
    const now = new Date().toISOString()
    const plan = validatePlan(input.plan)
    const record: OperationRecord = {
      schemaVersion: 1,
      id,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      status: plan ? "draft" : "draft",
      objective,
      sessionIDs: [sessionID],
      scope: structuredClone(input.scope),
      plan,
      goal: {
        status: "active",
        startedAt: now,
        targetDurationMs: input.goal?.targetDurationMs,
        continuation: {
          enabled: input.goal?.continuation?.enabled ?? true,
          maxNoToolTurns: input.goal?.continuation?.maxNoToolTurns ?? 1,
          noToolStreak: 0,
        },
        gates: input.goal?.gates ? [...input.goal.gates] : [...DEFAULT_COMPLETION_GATES],
      },
      executions: [],
      artifacts: [],
      handoffs: [],
    }
    return this.#store.create(record)
  }

  async approvePlan(id: string, approval: Approval) {
    const record = await this.#require(id)
    if (!record.plan) throw new Error("operation plan is missing")
    const approvedBy = approval.approvedBy.trim()
    if (record.plan.approvedAt) {
      if (record.plan.approvedBy === approvedBy && (!approval.at || approval.at === record.plan.approvedAt)) return record
      throw new OperationConflictError("approved plan must be amended before it can be approved again")
    }
    if (record.status !== "draft" && record.status !== "planned") throw new OperationConflictError("operation plan cannot be approved after execution starts")
    const at = approval.at ?? new Date().toISOString()
    const plan = { ...record.plan, approvedAt: at, approvedBy }
    if (!plan.approvedBy) throw new Error("approvedBy is required")
    const updated: OperationRecord = { ...record, revision: record.revision + 1, updatedAt: at, status: "planned", plan }
    return (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: "plan.approved",
      idempotencyKey: `plan.approved:${plan.version}:${plan.approvedBy}`,
      actor: { kind: "operator", id: plan.approvedBy },
      data: { planVersion: plan.version, approvedAt: at, approvedBy: plan.approvedBy },
      operation: updated,
    })).operation
  }

  async setPlan(id: string, input: NonNullable<OperationCreateInput["plan"]>, now = new Date()) {
    const record = await this.#require(id)
    if (record.status !== "draft" && record.status !== "planned") {
      throw new OperationConflictError("a plan can only be written before execution starts")
    }
    if (record.executions.length) throw new OperationConflictError("a plan cannot be amended after execution records exist")
    const parsed = validatePlan(input)
    if (!parsed) throw new Error("operation plan is required")
    if (record.plan && planIdentity(record.plan) === planIdentity(parsed)) return record
    const plan = { ...parsed, version: (record.plan?.version ?? 0) + 1 }
    const updated: OperationRecord = {
      ...record,
      revision: record.revision + 1,
      updatedAt: now.toISOString(),
      status: "draft",
      plan,
      goal: { ...record.goal, status: "active", review: undefined, completion: undefined },
      reportSourceRevision: undefined,
      reportSourceDigest: undefined,
      audit: undefined,
    }
    return (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: "plan.set",
      idempotencyKey: `plan.set:${record.revision}:${createHash("sha256").update(JSON.stringify(plan)).digest("hex")}`,
      actor: { kind: "operator" },
      data: { planVersion: plan.version, phaseIDs: plan.phases.map((phase) => phase.id) },
      operation: updated,
    })).operation
  }

  async tick(id: string, input: { now?: Date; goalVerdict?: GoalVerdict } = {}): Promise<SchedulerDecision> {
    let record = await this.#require(id)
    const now = input.now ?? new Date()
    if (record.goal.status === "complete") {
      const completion = await this.evaluateCompletion(id, { now })
      return completion.completed
        ? { action: "complete", operation: completion.operation }
        : { action: "blocked", blockers: completion.blockers, operation: completion.operation }
    }
    if (record.status === "interrupted") return { action: "blocked", blockers: ["operation is interrupted; recover or resume it before scheduling more work"], operation: record }
    if (input.goalVerdict) {
      const review = await this.reviewGoal(id, input.goalVerdict, { now, toolUsed: true })
      record = review.operation
      if (review.continuation === "complete") return { action: "complete", operation: record }
      if (review.continuation === "operator_required") return { action: "blocked", blockers: review.blockers, operation: record }
    }
    if (!record.plan?.approvedAt) return { action: "blocked", blockers: ["operation plan is not approved"], operation: record }
    const current = record.executions.find((execution) => execution.status === "intent" || execution.status === "running")
    if (current) {
      if (!current.receipt) {
        const operation = await this.#updateExecution(record, current, { status: "unknown", errorSummary: "launch receipt is missing; dispatch outcome must be reconciled" }, now)
        return { action: "blocked", blockers: ["execution outcome is unknown because no adapter receipt was persisted"], operation }
      }
      const observation = await this.#adapter.inspect(current.receipt)
      const operation = await this.#applyObservation(record, current, observation, now)
      if (observation.status === "running") return { action: "wait", reason: observation.summary ?? "execution is still running", operation }
      if (observation.status === "unknown") return { action: "blocked", blockers: [observation.summary ?? "execution state is unknown"], operation }
      if (observation.status === "failed" || observation.status === "interrupted") return { action: "blocked", blockers: [observation.summary ?? `execution ${observation.status}`], operation }
      record = operation
    }
    const phases = record.plan?.phases ?? []
    const phase = phases.find((item) => phaseReady(record, item))
    if (!phase) {
      if (!operationReady(record)) {
        const blockers = phases.filter((item) => item.required && item.status !== "complete").map((item) => `phase ${item.id} is ${item.status}`)
        return { action: "blocked", blockers, operation: record }
      }
      const elapsed = now.getTime() - Date.parse(record.goal.startedAt)
      if (record.goal.targetDurationMs !== undefined && elapsed < record.goal.targetDurationMs) {
        return { action: "expand", reason: `target operation window remains open for ${record.goal.targetDurationMs - elapsed}ms`, operation: record }
      }
      const completion = await this.evaluateCompletion(id, { now })
      return completion.completed
        ? { action: "complete", operation: completion.operation }
        : { action: "blocked", blockers: completion.blockers, operation: completion.operation }
    }
    return this.#launch(record, phase, now)
  }

  async interrupt(id: string, reason: string, now = new Date(), source: "operator" | "scheduler" = "operator") {
    const record = await this.#require(id)
    if (record.status === "interrupted" && source === "scheduler") return record
    const active = record.executions.filter((execution) => execution.status === "intent" || execution.status === "running")
    for (const execution of active) {
      const phase = record.plan?.phases.find((item) => item.id === execution.phaseID)
      if (phase) await this.#adapter.interrupt(execution.receipt, this.#launchRequest(record, phase, execution))
    }
    const executions = record.executions.map((execution) => active.some((item) => item.id === execution.id)
      ? { ...execution, status: "interrupted" as const, updatedAt: now.toISOString(), endedAt: now.toISOString(), errorSummary: reason }
      : execution)
    const updated: OperationRecord = { ...record, revision: record.revision + 1, updatedAt: now.toISOString(), status: "interrupted", executions, lastError: { code: "interrupted", message: reason, at: now.toISOString() } }
    return (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: "operation.interrupted",
      idempotencyKey: `operation.interrupted:${record.revision}`,
      actor: source === "operator" ? { kind: "operator" } : { kind: "engine", id: "scheduler" },
      data: { reason, source, executions: active.map((execution) => execution.id) },
      operation: updated,
    })).operation
  }

  async recover(id: string, now = new Date()): Promise<RecoverySummary> {
    let record = await this.#require(id)
    const recovered: string[] = []
    const waiting: string[] = []
    const blockers: string[] = []
    for (const execution of record.executions.filter((item) => item.status === "running" || item.status === "intent" || item.status === "interrupted" || item.status === "unknown")) {
      const phase = record.plan?.phases.find((item) => item.id === execution.phaseID)
      if (!phase) {
        blockers.push(`execution ${execution.id} references missing phase ${execution.phaseID}`)
        continue
      }
      if (!execution.receipt) {
        if (execution.status === "intent" || execution.status === "unknown") {
          const updated = await this.#updateExecution(record, execution, { status: "unknown", errorSummary: "launch intent has no receipt; automatic replay is unsafe" }, now)
          record = updated
          blockers.push(`execution ${execution.id} has an unknown launch outcome`)
        }
        continue
      }
      const observation = await this.#adapter.inspect(execution.receipt)
      if (observation.status === "running") {
        waiting.push(execution.id)
        continue
      }
      if (observation.status === "succeeded" || observation.status === "failed") {
        record = await this.#applyObservation(record, execution, observation, now)
        if (observation.status === "succeeded") recovered.push(execution.id)
        else blockers.push(`execution ${execution.id} failed: ${observation.summary ?? "adapter failure"}`)
        continue
      }
      if (observation.status === "unknown") {
        record = await this.#updateExecution(record, execution, { status: "unknown", errorSummary: observation.summary ?? "adapter cannot reconcile the receipt" }, now)
        blockers.push(`execution ${execution.id} outcome is unknown; it will not be relaunched automatically`)
        continue
      }
      if (phase.restart !== "safe") {
        record = await this.#updateExecution(record, execution, { status: "interrupted", errorSummary: "restart policy requires operator reconciliation" }, now)
        blockers.push(`phase ${phase.id} requires operator reconciliation before restart`)
        continue
      }
      const request = this.#launchRequest(record, phase, execution)
      const restart = await this.#adapter.recover(request, execution.receipt)
      if (!restart) {
        record = await this.#updateExecution(record, execution, { status: "unknown", errorSummary: "adapter did not confirm safe recovery" }, now)
        blockers.push(`adapter did not confirm safe recovery for execution ${execution.id}`)
        continue
      }
      record = await this.#updateExecution(record, execution, { status: "running", receipt: restart.receipt, attempt: execution.attempt + 1, errorSummary: undefined }, now)
      recovered.push(execution.id)
    }
    if (!blockers.length && record.status === "interrupted") {
      record = await this.#commit(record, "operation.recovered", `operation.recovered:${record.revision}`, { recovered, waiting }, { status: "running", lastError: undefined }, now)
    }
    return { operation: record, recovered, waiting, blockers }
  }

  async normalizeEvidence(id: string, now = new Date()) {
    const record = await this.#require(id)
    const directory = this.#store.directory(record.id)
    const sources = [...record.artifacts, ...record.executions.flatMap((execution) => execution.artifactRefs)]
      .filter((reference) => reference.path !== "evidence/normalized.json" && !reference.path.startsWith("deliverables/final/"))
    for (const reference of sources) {
      const actual = fileRef(directory, reference)
      if (actual.sha256 !== reference.sha256 || (reference.size !== undefined && actual.size !== reference.size)) {
        throw new OperationConflictError(`registered evidence source changed; register new bytes at a new path: ${reference.path}`)
      }
    }
    const evidence = await normalizeEvidence(record, directory)
    const normalizedFile = fileRef(directory, { path: "evidence/normalized.json", mediaType: "application/json" })
    const priorFile = record.artifacts.find((artifact) => artifact.path === normalizedFile.path)
    if (record.evidence && JSON.stringify(record.evidence) === JSON.stringify(evidence) && JSON.stringify(priorFile) === JSON.stringify(normalizedFile)) {
      return record
    }
    const updated: OperationRecord = {
      ...record,
      revision: record.revision + 1,
      updatedAt: now.toISOString(),
      evidence,
      artifacts: uniqueArtifacts([...record.artifacts, ...evidence.artifacts, normalizedFile]),
    }
    return (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: "evidence.normalized",
      idempotencyKey: `evidence.normalized:${record.revision}:${evidence.normalizerVersion}`,
      actor: { kind: "engine" },
      data: { normalizerVersion: evidence.normalizerVersion, claims: evidence.claims.length, artifacts: evidence.artifacts },
      operation: updated,
    })).operation
  }

  async recordArtifacts(id: string, artifacts: ArtifactRef[], now = new Date()) {
    const normalizedID = operationID(id)
    const directory = this.#store.directory(normalizedID)
    return withArtifactLock(directory, normalizedID, async () => {
      const record = await this.#require(normalizedID)
      const seen = new Set<string>()
      const validated = artifacts.map((artifact) => {
        assertPublicArtifactPath(artifact)
        const resolved = fileRef(directory, artifact)
        assertPublicArtifactPath({ ...artifact, path: resolved.path })
        if (seen.has(resolved.path)) throw new Error(`duplicate canonical artifact path: ${resolved.path}`)
        seen.add(resolved.path)
        return resolved
      })
      for (const item of validated) {
        const prior = record.artifacts.find((artifact) => artifact.path === item.path)
        if (prior?.sha256 && prior.sha256 !== item.sha256) {
          throw new OperationConflictError(`registered source artifact is immutable; use a new path instead of changing ${item.path}`)
        }
      }
      const nextArtifacts = uniqueArtifacts([...record.artifacts, ...validated])
      const identity = (items: ArtifactRef[]) => JSON.stringify(items.toSorted((left, right) => left.path.localeCompare(right.path)))
      if (identity(record.artifacts) === identity(nextArtifacts)) return record
      const updated: OperationRecord = {
        ...record,
        revision: record.revision + 1,
        updatedAt: now.toISOString(),
        artifacts: nextArtifacts,
        reportSourceRevision: undefined,
        reportSourceDigest: undefined,
        audit: undefined,
      }
      return (await this.#store.commit({
        operationID: record.id,
        expectedRevision: record.revision,
        type: "artifacts.recorded",
        idempotencyKey: `artifacts.recorded:${record.revision}:${createHash("sha256").update(JSON.stringify(validated)).digest("hex")}`,
        actor: { kind: "engine" },
        data: { artifacts: validated },
        operation: updated,
      })).operation
    })
  }

  async recordFindings(id: string, input: RecordFindingsInput, now = new Date()) {
    const parsed = recordFindingsInputSchema.parse(input)
    const normalizedID = operationID(id)
    const directory = this.#store.directory(normalizedID)
    return withArtifactLock(directory, normalizedID, async () => {
      const record = await this.#require(normalizedID)
      const knownEvidence = new Set(record.evidence?.claims.map((claim) => claim.id) ?? [])
      for (const finding of parsed.findings) {
        for (const evidenceID of finding.evidenceIDs) {
          if (!knownEvidence.has(evidenceID)) throw new Error(`finding ${finding.id} references unknown evidence ID: ${evidenceID}`)
        }
      }
      const file = path.join(directory, "findings", "findings.json")
      ensureRealOperationDirectory(directory, path.dirname(file))
      const previous = existsSync(file) ? readFileSync(file) : undefined
      const registeredFindings = record.artifacts.find((artifact) => artifact.path === "findings/findings.json")
      if (previous && !registeredFindings) {
        throw new OperationConflictError("an existing findings artifact is unregistered; explicit recovery is required before updating it")
      }
      if (!previous && registeredFindings) {
        throw new OperationConflictError("the registered findings artifact is missing; explicit recovery is required before updating it")
      }
      if (previous && registeredFindings) {
        const actual = fileRef(directory, registeredFindings)
        if (actual.sha256 !== registeredFindings.sha256 || (registeredFindings.size !== undefined && actual.size !== registeredFindings.size)) {
          throw new OperationConflictError("registered findings source changed; restore it or use explicit recovery before updating it")
        }
      }
      const priorDocument = previous
        ? findingDocumentSchema.parse(JSON.parse(previous.toString("utf8")))
        : undefined
      if (priorDocument && priorDocument.operationID !== record.id) throw new OperationConflictError("findings artifact belongs to a different operation")
      const submittedIDs = new Set(parsed.findings.map((finding) => finding.id))
      const retainedRejected = priorDocument?.findings.filter((finding) => !submittedIDs.has(finding.id)) ?? []
      for (const prior of priorDocument?.findings ?? []) {
        if (
          (prior.state === "validated" || prior.state === "report_ready" || prior.state === "rejected") &&
          (!prior.reviewedBy || !prior.validationRationale || ((prior.state === "validated" || prior.state === "report_ready") && !prior.evidenceIDs.length))
        ) throw new OperationConflictError(`prior finding ${prior.id} has an incomplete review record`)
        const submitted = parsed.findings.find((finding) => finding.id === prior.id)
        if (!submitted && prior.state !== "rejected") {
          throw new OperationConflictError(`finding ${prior.id} must remain in canonical history until explicitly rejected`)
        }
        if (submitted && prior.state === "rejected" && submitted.state !== "rejected") {
          throw new OperationConflictError(`rejected finding ${prior.id} cannot be reopened`)
        }
      }
      const findings = [
        ...parsed.findings.map((finding) => ({
          ...finding,
          ...(parsed.reviewedBy ? { reviewedBy: parsed.reviewedBy } : {}),
        })),
        ...retainedRejected,
      ]
      const document = findingDocumentSchema.parse({ operationID: record.id, findings })
      const serialized = `${JSON.stringify(document, null, 2)}\n`
      const writtenHash = createHash("sha256").update(serialized).digest("hex")
      try {
        writeAtomic(file, serialized)
        const artifact = fileRef(directory, { path: "findings/findings.json", mediaType: "application/json" })
        const existing = record.artifacts.find((item) => item.path === artifact.path)
        if (existing?.sha256 === artifact.sha256) return record
        const updated: OperationRecord = {
          ...record,
          revision: record.revision + 1,
          updatedAt: now.toISOString(),
          artifacts: uniqueArtifacts([...record.artifacts, artifact]),
          reportSourceRevision: undefined,
          reportSourceDigest: undefined,
          audit: undefined,
        }
        return (await this.#store.commit({
          operationID: record.id,
          expectedRevision: record.revision,
          type: "findings.recorded",
          idempotencyKey: `findings.recorded:${record.revision}:${artifact.sha256}`,
          actor: { kind: "operator", id: parsed.reviewedBy },
          data: { artifact, findings: findings.map(({ id: findingID, state }) => ({ id: findingID, state })) },
          operation: updated,
        })).operation
      } catch (error) {
        try {
          restoreFile(file, previous, writtenHash)
        } catch (restoreError) {
          throw new AggregateError([error, restoreError], "findings write conflicted and its prior artifact could not be restored")
        }
        throw error
      }
    })
  }

  async recordReport(id: string, input: { sourceRevision: number; sourceDigest: string; artifacts: ArtifactRef[] }, now = new Date()) {
    const record = await this.#require(id)
    if (record.revision !== input.sourceRevision || operationSourceDigest(record) !== input.sourceDigest) {
      throw new OperationConflictError("report source snapshot is stale; render again from the current operation")
    }
    const allowed = new Set([
      "deliverables/final/report.html",
      "deliverables/final/report.pdf",
      "deliverables/final/manifest.json",
      "deliverables/final/runtime-summary.json",
    ])
    const artifacts = input.artifacts.map((artifact) => fileRef(this.#store.directory(record.id), artifact))
    if (artifacts.length !== allowed.size || artifacts.some((artifact) => !allowed.has(artifact.path)) || new Set(artifacts.map((item) => item.path)).size !== allowed.size) {
      throw new Error("report registration requires exactly the four canonical final artifact paths")
    }
    const manifestFile = path.join(this.#store.directory(record.id), "deliverables/final/manifest.json")
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
      operationID?: unknown
      sourceRevision?: unknown
      sourceDigest?: unknown
      files?: Array<{ path?: unknown; sha256?: unknown }>
    }
    if (manifest.operationID !== record.id || manifest.sourceRevision !== input.sourceRevision || manifest.sourceDigest !== input.sourceDigest) {
      throw new Error("report manifest does not match the registered source snapshot")
    }
    const expectedFiles = [
      "deliverables/final/report.html",
      "deliverables/final/report.pdf",
      "deliverables/final/runtime-summary.json",
    ]
    if (!Array.isArray(manifest.files) || manifest.files.length !== expectedFiles.length) throw new Error("report manifest must hash exactly the three rendered files")
    const manifestHashes = new Map(manifest.files.flatMap((file) =>
      typeof file.path === "string" && typeof file.sha256 === "string" ? [[file.path, file.sha256] as const] : [],
    ))
    if (manifestHashes.size !== expectedFiles.length) throw new Error("report manifest contains duplicate or malformed file entries")
    for (const relative of expectedFiles) {
      const artifact = artifacts.find((item) => item.path === relative)
      if (!artifact || manifestHashes.get(relative) !== artifact.sha256) throw new Error(`report manifest hash mismatch for ${relative}`)
    }
    const updated: OperationRecord = {
      ...record,
      revision: record.revision + 1,
      updatedAt: now.toISOString(),
      artifacts: uniqueArtifacts([...record.artifacts, ...artifacts]),
      reportSourceRevision: input.sourceRevision,
      reportSourceDigest: input.sourceDigest,
    }
    return (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: "report.registered",
      idempotencyKey: `report.registered:${input.sourceRevision}:${input.sourceDigest}`,
      actor: { kind: "engine" },
      data: { sourceRevision: input.sourceRevision, sourceDigest: input.sourceDigest, artifacts },
      operation: updated,
    })).operation
  }

  async reviewGoal(
    id: string,
    verdict: GoalVerdict,
    input: { now?: Date; reason?: string; toolUsed?: boolean; idempotencyKey?: string } = {},
  ): Promise<GoalReviewResult> {
    const record = await this.#require(id)
    const idempotencyKey = input.idempotencyKey ?? `goal.reviewed:${record.revision}:${verdict}`
    const prior = (await this.#store.events(record.id)).find((event) => event.idempotencyKey === idempotencyKey)
    if (prior) {
      const priorData = prior.data as { verdict?: unknown; reason?: unknown; toolUsed?: unknown }
      if (
        prior.type !== "goal.reviewed" ||
        priorData.verdict !== verdict ||
        priorData.reason !== input.reason ||
        priorData.toolUsed !== (input.toolUsed ?? false)
      ) throw new OperationConflictError("goal review idempotency key was reused with a different command")
      if (verdict === "done" && record.goal.status !== "complete") {
        const completion = await this.evaluateCompletion(id, { now: input.now, idempotencyKey: `${idempotencyKey}:completion` })
        const overBudget = completion.operation.goal.continuation.enabled &&
          completion.operation.goal.continuation.noToolStreak > completion.operation.goal.continuation.maxNoToolTurns
        return {
          operation: completion.operation,
          continuation: completion.completed ? "complete" : overBudget ? "operator_required" : "continue",
          blockers: overBudget
            ? [...completion.blockers, `no-tool continuation limit ${completion.operation.goal.continuation.maxNoToolTurns} was reached`]
            : completion.blockers,
        }
      }
      const overBudget = record.goal.continuation.enabled && record.goal.continuation.noToolStreak > record.goal.continuation.maxNoToolTurns
      return { operation: record, continuation: record.goal.status === "complete" ? "complete" : verdict === "needs_operator" || overBudget ? "operator_required" : "continue", blockers: record.goal.completion?.blockers ?? [] }
    }
    const updated = recordGoalReview(record, verdict, input)
    updated.revision = record.revision + 1
    const committed = (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: "goal.reviewed",
      idempotencyKey,
      actor: { kind: "engine" },
      data: { verdict, reason: input.reason, toolUsed: input.toolUsed ?? false, noToolStreak: updated.goal.continuation.noToolStreak },
      operation: updated,
    })).operation
    if (verdict === "done") {
      const completion = await this.evaluateCompletion(id, { now: input.now, idempotencyKey: `${idempotencyKey}:completion` })
      const overBudget = completion.operation.goal.continuation.enabled &&
        completion.operation.goal.continuation.noToolStreak > completion.operation.goal.continuation.maxNoToolTurns
      return {
        operation: completion.operation,
        continuation: completion.completed ? "complete" : overBudget ? "operator_required" : "continue",
        blockers: overBudget
          ? [...completion.blockers, `no-tool continuation limit ${completion.operation.goal.continuation.maxNoToolTurns} was reached`]
          : completion.blockers,
      }
    }
    const overBudget = committed.goal.continuation.enabled && committed.goal.continuation.noToolStreak > committed.goal.continuation.maxNoToolTurns
    return {
      operation: committed,
      continuation: verdict === "needs_operator" || overBudget ? "operator_required" : "continue",
      blockers: overBudget ? [`no-tool continuation limit ${committed.goal.continuation.maxNoToolTurns} was reached`] : [],
    }
  }

  async evaluateCompletion(id: string, input: { now?: Date; idempotencyKey?: string } = {}): Promise<GoalCompletionResult> {
    const record = await this.#require(id)
    const idempotencyKey = input.idempotencyKey ?? `goal.completion.checked:${record.revision}`
    const prior = (await this.#store.events(record.id)).find((event) => event.idempotencyKey === idempotencyKey)
    if (prior) {
      if (record.goal.status === "complete") return { completed: true, blockers: [], operation: record }
      return { completed: false, blockers: record.goal.completion?.blockers ?? [], operation: record }
    }
    const now = input.now ?? new Date()
    const blockers = await completionBlockers(record, { operationDirectory: this.#store.directory(record.id), now })
    if (record.goal.status === "complete" && !blockers.length) return { completed: true, blockers: [], operation: record }
    const gate = applyCompletionGate(record, blockers, now)
    gate.operation.revision = record.revision + 1
    const operation = (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: "goal.completion.checked",
      idempotencyKey,
      actor: { kind: "engine" },
      data: { completed: gate.completed, blockers: gate.blockers },
      operation: gate.operation,
    })).operation
    return { completed: gate.completed, blockers: gate.blockers, operation }
  }

  async handoff(
    id: string,
    input: { phaseID: string; childID: string; status?: SubordinateHandoff["status"]; artifacts?: ArtifactRef[] },
    now = new Date(),
  ) {
    const record = await this.#require(id)
    const phase = record.plan?.phases.find((item) => item.id === input.phaseID)
    if (!phase) throw new Error(`unknown operation phase: ${input.phaseID}`)
    if (!input.childID.trim()) throw new Error("childID is required")
    const handoffID = `${input.phaseID}:${input.childID}`
    const status = input.status ?? "offered"
    const existing = record.handoffs.find((item) => item.id === handoffID)
    const allowedArtifactPrefix = `subagents/${input.phaseID}/${input.childID}/`
    const artifacts = (input.artifacts ?? []).map((artifact) => fileRef(this.#store.directory(record.id), artifact))
    for (const artifact of artifacts) if (!artifact.path.startsWith(allowedArtifactPrefix)) throw new Error("child artifacts must stay under the handoff artifact prefix")
    const handoff: SubordinateHandoff = {
      id: handoffID,
      phaseID: input.phaseID,
      childID: input.childID,
      createdAt: existing?.createdAt ?? now.toISOString(),
      status,
      allowedArtifactPrefix,
      artifactRefs: uniqueArtifacts([...(existing?.artifactRefs ?? []), ...artifacts]),
    }
    const updated: OperationRecord = {
      ...record,
      revision: record.revision + 1,
      updatedAt: now.toISOString(),
      handoffs: [...record.handoffs.filter((item) => item.id !== handoffID), handoff],
      artifacts: uniqueArtifacts([...record.artifacts, ...artifacts]),
    }
    const committed = (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: `handoff.${status}`,
      idempotencyKey: `handoff:${handoffID}:${status}:${record.revision}`,
      actor: { kind: "engine", id: input.childID },
      data: { handoffID, phaseID: input.phaseID, childID: input.childID, status, artifacts },
      operation: updated,
    })).operation
    return {
      operation: committed,
      handoff,
      envelope: {
        operationID: record.id,
        phaseID: input.phaseID,
        childID: input.childID,
        objective: phase.title,
        successCriteria: phase.successCriteria,
        artifactPrefix: allowedArtifactPrefix,
      },
    }
  }

  async #launch(record: OperationRecord, phase: OperationPhase, now: Date): Promise<SchedulerDecision> {
    const attempt = record.executions.filter((execution) => execution.phaseID === phase.id).length + 1
    const executionID = randomUUID()
    const idempotencyKey = `launch:${phase.id}:${attempt}`
    let execution: OperationExecution = {
      id: executionID,
      phaseID: phase.id,
      adapter: this.#adapter.id,
      idempotencyKey,
      status: "intent",
      attempt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      artifactRefs: [],
    }
    const launchRequest = this.#launchRequest(record, phase, execution)
    try {
      this.#adapter.validatePhase?.(launchRequest)
      execution = { ...execution, receipt: this.#adapter.receipt(launchRequest) }
    } catch (error) {
      const message = error instanceof Error ? error.message : "execution adapter rejected this phase"
      return { action: "blocked", blockers: [message], operation: record }
    }
    let updated = withPhase(record, phase.id, (item) => ({ ...item, status: "running" }))
    updated = { ...updated, executions: [...updated.executions, execution], status: "running", revision: record.revision + 1, updatedAt: now.toISOString() }
    const intent = await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: "execution.intent",
      idempotencyKey: `execution.intent:${idempotencyKey}`,
      actor: { kind: "engine" },
      data: { executionID, phaseID: phase.id, adapter: this.#adapter.id, idempotencyKey },
      operation: updated,
    })
    const request = this.#launchRequest(intent.operation, phase, execution)
    try {
      const launched = await this.#adapter.launch(request)
      if (launched.receipt !== execution.receipt) throw new Error("adapter receipt differs from its durable prelaunch identity")
      const latest = await this.#require(record.id)
      const latestExecution = latest.executions.find((item) => item.id === execution.id)
      if (latestExecution?.status === "interrupted") {
        return { action: "blocked", blockers: ["execution was interrupted while its adapter launch was in flight"], operation: latest }
      }
      if (latest.revision !== intent.operation.revision) {
        throw new OperationConflictError("operation changed while execution adapter was launching; inspect the persisted receipt before continuing")
      }
      const running = await this.#updateExecution(intent.operation, execution, { status: "running", receipt: launched.receipt }, now)
      return { action: "launch", request, receipt: launched.receipt, operation: running }
    } catch (error) {
      const message = error instanceof Error ? error.message : "adapter launch failed with an unknown error"
      const operation = await this.#updateExecution(intent.operation, execution, { status: "unknown", errorSummary: message }, now)
      return { action: "blocked", blockers: [`adapter dispatch outcome is unknown: ${message}`], operation }
    }
  }

  #launchRequest(record: OperationRecord, phase: OperationPhase, execution: OperationExecution): LaunchRequest {
    return {
      operationID: record.id,
      executionID: execution.id,
      phase,
      idempotencyKey: execution.idempotencyKey,
      attempt: execution.attempt,
      artifactDirectory: this.#store.directory(record.id),
      scope: record.scope,
    }
  }

  async #applyObservation(record: OperationRecord, execution: OperationExecution, observation: ExecutionObservation, now: Date) {
    const directory = this.#store.directory(record.id)
    const artifacts = observation.artifactRefs.map((reference) => fileRef(directory, reference))
    const updatedExecution: OperationExecution = {
      ...execution,
      status: observation.status,
      updatedAt: now.toISOString(),
      endedAt: observation.status === "running" ? undefined : now.toISOString(),
      checkpointRef: observation.checkpointRef,
      artifactRefs: uniqueArtifacts([...execution.artifactRefs, ...artifacts]),
      errorSummary: observation.status === "failed" || observation.status === "unknown" ? observation.summary : undefined,
    }
    let updated: OperationRecord = {
      ...record,
      executions: record.executions.map((item) => item.id === execution.id ? updatedExecution : item),
      artifacts: uniqueArtifacts([...record.artifacts, ...artifacts]),
      status: observation.status === "running" ? "running" : observation.status === "interrupted" ? "interrupted" : record.status,
      updatedAt: now.toISOString(),
    }
    if (observation.status === "succeeded") {
      const phase = updated.plan?.phases.find((item) => item.id === execution.phaseID)
      const missing = (phase?.expectedArtifacts ?? []).filter((expected) => !artifacts.some((artifact) => artifact.path === expected || artifact.path.startsWith(`${expected.replace(/\/$/, "")}/`)))
      if (missing.length) {
        updated = withPhase(updated, execution.phaseID, (item) => ({ ...item, status: "blocked" }))
        updated.status = "blocked"
        updated.lastError = { code: "artifact-proof-missing", message: `missing expected artifacts: ${missing.join(", ")}`, at: now.toISOString() }
      } else {
        updated = withPhase(updated, execution.phaseID, (item) => ({ ...item, status: "complete" }))
        updated = { ...updated, plan: updated.plan ? { ...updated.plan, phases: updated.plan.phases.map((item) => item.status === "pending" && phaseReady(updated, { ...item, status: "ready" }) ? { ...item, status: "ready" as const } : item) } : undefined }
        updated.status = "planned"
        updated.lastError = undefined
      }
    } else if (observation.status === "failed") {
      updated = withPhase(updated, execution.phaseID, (item) => ({ ...item, status: "failed" }))
      updated.status = "blocked"
      updated.lastError = { code: "execution-failed", message: observation.summary ?? "adapter execution failed", at: now.toISOString() }
    } else if (observation.status === "unknown") {
      updated = withPhase(updated, execution.phaseID, (item) => ({ ...item, status: "blocked" }))
      updated.status = "blocked"
      updated.lastError = { code: "execution-unknown", message: observation.summary ?? "adapter could not reconcile the execution", at: now.toISOString() }
    }
    const next = { ...updated, revision: record.revision + 1 }
    return (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: `execution.${observation.status}`,
      idempotencyKey: `execution.observation:${execution.id}:${observation.status}:${execution.updatedAt}`,
      actor: { kind: "adapter", id: this.#adapter.id },
      data: { executionID: execution.id, ...observation, artifacts },
      operation: next,
    })).operation
  }

  async #updateExecution(
    record: OperationRecord,
    execution: OperationExecution,
    change: Partial<OperationExecution>,
    now: Date,
  ) {
    const updatedExecution = { ...execution, ...change, updatedAt: now.toISOString() }
    const updated: OperationRecord = {
      ...record,
      revision: record.revision + 1,
      updatedAt: now.toISOString(),
      executions: record.executions.map((item) => item.id === execution.id ? updatedExecution : item),
      status: updatedExecution.status === "unknown" ? "blocked" : updatedExecution.status === "interrupted" ? "interrupted" : record.status,
      ...(updatedExecution.errorSummary ? { lastError: { code: `execution-${updatedExecution.status}`, message: updatedExecution.errorSummary, at: now.toISOString() } } : {}),
    }
    return (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type: `execution.${updatedExecution.status}`,
      idempotencyKey: `execution.update:${execution.id}:${updatedExecution.status}:${updatedExecution.updatedAt}`,
      actor: { kind: "adapter", id: this.#adapter.id },
      data: { executionID: execution.id, ...change },
      operation: updated,
    })).operation
  }

  async #commit(
    record: OperationRecord,
    type: string,
    idempotencyKey: string,
    data: unknown,
    patch: Partial<OperationRecord>,
    now: Date,
  ) {
    const operation = { ...record, ...patch, revision: record.revision + 1, updatedAt: now.toISOString() }
    return (await this.#store.commit({
      operationID: record.id,
      expectedRevision: record.revision,
      type,
      idempotencyKey,
      actor: { kind: "engine" },
      data,
      operation,
    })).operation
  }

  async #require(id: string) {
    const record = await this.#store.get(id)
    if (!record) throw new Error(`operation does not exist: ${id}`)
    return record
  }
}
