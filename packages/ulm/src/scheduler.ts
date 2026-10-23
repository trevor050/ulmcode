import { randomUUID } from "node:crypto"
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { OperationEvent, OperationRecord, SchedulerDecision } from "./operation"
import { operationSourceDigest } from "./operation"
import { lintReport } from "./report"
import { OperationConflictError, OperationStore } from "./store"
import { OperationEngine } from "./engine"

export type SchedulerReportInput = { operation: OperationRecord; operationDirectory: string }
export type SchedulerResult = {
  action: "complete" | "blocked" | "expand" | "interrupted"
  operation: OperationRecord
  blockers: string[]
  reason?: string
}

type SchedulerState = {
  schemaVersion: 1
  operationID: string
  pid: number
  token: string
  status: SchedulerResult["action"] | "running"
  startedAt: string
  heartbeatAt: string
  lastAction?: SchedulerDecision["action"] | "report"
  lastError?: string
  reportSourceDigest?: string
  interruptedBySignal?: boolean
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function writeState(file: string, state: SchedulerState) {
  const temporary = `${file}.${state.token}.tmp`
  const descriptor = openSync(temporary, "w", 0o600)
  try {
    writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, file)
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, milliseconds)
    const onAbort = () => done()
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function latestInterruptSource(events: OperationEvent[]) {
  const event = [...events].reverse().find((item) => item.type === "operation.interrupted")
  const data = event?.data
  return data && typeof data === "object" && "source" in data && data.source === "scheduler" ? "scheduler" : "operator"
}

/** Runs one explicitly named operation while persisting safe scheduler progress and a heartbeat. */
export class OperationScheduler {
  readonly #engine: OperationEngine
  readonly #store: OperationStore
  readonly #report: (input: SchedulerReportInput) => Promise<unknown>
  readonly #pollIntervalMs: number
  readonly #heartbeatIntervalMs: number

  constructor(input: {
    engine: OperationEngine
    store: OperationStore
    report: (input: SchedulerReportInput) => Promise<unknown>
    pollIntervalMs?: number
    heartbeatIntervalMs?: number
  }) {
    this.#engine = input.engine
    this.#store = input.store
    this.#report = input.report
    this.#pollIntervalMs = Math.max(10, input.pollIntervalMs ?? 250)
    this.#heartbeatIntervalMs = Math.max(100, input.heartbeatIntervalMs ?? 5_000)
  }

  async run(id: string, input: { signal?: AbortSignal; resume?: boolean } = {}): Promise<SchedulerResult> {
    const operation = await this.#store.get(id)
    if (!operation) throw new Error(`unknown operation: ${id}`)
    const directory = this.#store.directory(operation.id)
    const runtimeDirectory = path.join(directory, "runtime")
    mkdirSync(runtimeDirectory, { recursive: true })
    const lockPath = path.join(runtimeDirectory, "scheduler.lock")
    const statePath = path.join(runtimeDirectory, "scheduler.json")
    const token = randomUUID()
    const oldState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) as Partial<SchedulerState> : undefined
    const priorInterruptSource = latestInterruptSource(await this.#store.events(operation.id))
    const lock = this.#acquireLock(lockPath, operation.id, token)
    const now = new Date().toISOString()
    let state: SchedulerState = {
      schemaVersion: 1,
      operationID: operation.id,
      pid: process.pid,
      token,
      status: "running",
      startedAt: now,
      heartbeatAt: now,
      lastAction: undefined,
      reportSourceDigest: oldState?.reportSourceDigest,
    }
    writeState(statePath, state)
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined
    let abortTask: Promise<void> | undefined
    const signal = input.signal
    const onAbort = () => {
      abortTask ??= (async () => {
        let interruptedByThisSignal = false
        try {
          const current = await this.#store.get(operation.id)
          if (current && current.status !== "interrupted" && current.status !== "completed") {
            await this.#engine.interrupt(operation.id, "scheduler received shutdown signal", new Date(), "scheduler")
            interruptedByThisSignal = latestInterruptSource(await this.#store.events(operation.id)) === "scheduler"
          }
        } catch (error) {
          state.lastError = error instanceof Error ? error.message : "scheduler interruption failed"
        }
        state.status = "interrupted"
        state.interruptedBySignal = interruptedByThisSignal
        state.heartbeatAt = new Date().toISOString()
        writeState(statePath, state)
      })()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    heartbeatTimer = setInterval(() => {
      state.heartbeatAt = new Date().toISOString()
      try {
        writeState(statePath, state)
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : "heartbeat persistence failed"
      }
    }, this.#heartbeatIntervalMs)

    try {
      let current = operation
      if (current.status === "interrupted") {
        if (!input.resume || priorInterruptSource !== "scheduler") {
          state.status = "blocked"
          state.lastError = "operation is interrupted by an operator; explicit operation recovery is required"
          writeState(statePath, state)
          return { action: "blocked", operation: current, blockers: [state.lastError] }
        }
        const recovered = await this.#engine.recover(operation.id)
        current = recovered.operation
        if (recovered.blockers.length) {
          state.status = "blocked"
          state.lastError = recovered.blockers.join("; ")
          writeState(statePath, state)
          return { action: "blocked", operation: current, blockers: recovered.blockers }
        }
        state.interruptedBySignal = false
      }

      let completionPrepared = false
      while (!signal?.aborted) {
        current = (await this.#store.get(operation.id)) ?? current
        if (this.#requiredPhasesComplete(current)) {
          const elapsed = Date.now() - Date.parse(current.goal.startedAt)
          if (current.goal.targetDurationMs !== undefined && elapsed < current.goal.targetDurationMs) {
            state.status = "expand"
            state.lastAction = "expand"
            writeState(statePath, state)
            return { action: "expand", operation: current, blockers: [], reason: `target operation window remains open for ${current.goal.targetDurationMs - elapsed}ms` }
          }
          current = await this.#engine.normalizeEvidence(operation.id)
          current = (await this.#store.get(operation.id)) ?? current
          const digest = operationSourceDigest(current)
          const existingReport = current.reportSourceDigest === digest
            ? await lintReport({ operation: current, operationDirectory: directory, requireAudit: false })
            : undefined
          if (!existingReport?.ok) {
            state.lastAction = "report"
            state.heartbeatAt = new Date().toISOString()
            writeState(statePath, state)
            try {
              await this.#report({ operation: current, operationDirectory: directory })
              current = (await this.#store.get(operation.id)) ?? current
              state.reportSourceDigest = operationSourceDigest(current)
              state.lastError = undefined
            } catch (error) {
              if (signal?.aborted) {
                await abortTask
                current = (await this.#store.get(operation.id)) ?? current
                return { action: "interrupted", operation: current, blockers: [] }
              }
              const message = error instanceof Error ? error.message : "reporting callback failed"
              state.status = "blocked"
              state.lastError = message
              state.heartbeatAt = new Date().toISOString()
              writeState(statePath, state)
              return { action: "blocked", operation: current, blockers: [`reporting callback failed: ${message}`] }
            }
          }
          completionPrepared = true
        }

        const decision = await this.#engine.tick(operation.id)
        current = decision.operation
        state.lastAction = decision.action
        state.heartbeatAt = new Date().toISOString()
        if (signal?.aborted) {
          await abortTask
          const interrupted = (await this.#store.get(operation.id)) ?? current
          return { action: "interrupted", operation: interrupted, blockers: [] }
        }
        if (decision.action === "complete") {
          state.status = "complete"
          state.lastError = undefined
          writeState(statePath, state)
          return { action: "complete", operation: decision.operation, blockers: [] }
        }
        if (decision.action === "blocked") {
          if (!completionPrepared && this.#requiredPhasesComplete(decision.operation)) continue
          state.status = "blocked"
          state.lastError = decision.blockers.join("; ")
          writeState(statePath, state)
          return { action: "blocked", operation: decision.operation, blockers: decision.blockers }
        }
        if (decision.action === "expand") {
          state.status = "expand"
          writeState(statePath, state)
          return { action: "expand", operation: decision.operation, blockers: [], reason: decision.reason }
        }
        state.status = "running"
        writeState(statePath, state)
        if (decision.action === "wait") await delay(this.#pollIntervalMs, signal)
      }

      await onAbort()
      await abortTask
      const interrupted = (await this.#store.get(operation.id)) ?? current
      return { action: "interrupted", operation: interrupted, blockers: [] }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      signal?.removeEventListener("abort", onAbort)
      this.#releaseLock(lockPath, lock)
    }
  }

  #requiredPhasesComplete(operation: OperationRecord) {
    return operation.plan?.phases.filter((phase) => phase.required).every((phase) => phase.status === "complete") ?? false
  }

  #acquireLock(file: string, operationID: string, token: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const descriptor = openSync(file, "wx", 0o600)
        writeFileSync(descriptor, JSON.stringify({ operationID, pid: process.pid, token }))
        fsyncSync(descriptor)
        closeSync(descriptor)
        return token
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error
        let owner: { pid?: unknown; token?: unknown }
        try {
          owner = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown; token?: unknown }
        } catch {
          throw new OperationConflictError(`scheduler lock exists but is unreadable: ${file}`)
        }
        if (typeof owner.pid !== "number" || processIsAlive(owner.pid)) {
          throw new OperationConflictError(`operation ${operationID} already has an active scheduler (pid ${String(owner.pid)})`)
        }
        unlinkSync(file)
      }
    }
    throw new OperationConflictError(`could not acquire scheduler lock for ${operationID}`)
  }

  #releaseLock(file: string, token: string) {
    try {
      const owner = JSON.parse(readFileSync(file, "utf8")) as { token?: unknown }
      if (owner.token === token) unlinkSync(file)
    } catch {
      // A lock removed by another recovery process is already released.
    }
  }
}
