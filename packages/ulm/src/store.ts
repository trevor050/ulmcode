import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { OperationEvent, OperationRecord, StoreCommitInput, StoreCommitResult } from "./operation"
import { operationID, sessionID } from "./operation"

type EventRow = {
  seq: number
  revision: number
  at: string
  type: string
  idempotency_key: string
  actor_json: string
  data_json: string
  record_json: string
}

type SnapshotRow = { revision: number; record_json: string }

function createIdentity(record: OperationRecord) {
  return JSON.stringify({
    id: record.id,
    objective: record.objective,
    sessionIDs: record.sessionIDs,
    scope: record.scope,
    plan: record.plan,
    goal: {
      targetDurationMs: record.goal.targetDurationMs,
      continuation: {
        enabled: record.goal.continuation.enabled,
        maxNoToolTurns: record.goal.continuation.maxNoToolTurns,
      },
      gates: record.goal.gates,
    },
  })
}

export class OperationConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OperationConflictError"
  }
}

/** SQLite is canonical per operation. The JSON projection can be rebuilt from the event rows. */
export class OperationStore {
  readonly #root: string
  readonly #databases = new Map<string, Database>()
  readonly #sessionIndex: Database

  constructor(input: { workspaceRoot: string }) {
    this.#root = path.resolve(input.workspaceRoot, ".ulmcode", "operations")
    mkdirSync(this.#root, { recursive: true })
    this.#sessionIndex = new Database(path.join(this.#root, "session-index.db"), { create: true, readwrite: true })
    this.#sessionIndex.run("PRAGMA journal_mode = WAL")
    this.#sessionIndex.run("PRAGMA busy_timeout = 5000")
    this.#sessionIndex.run("CREATE TABLE IF NOT EXISTS bindings (session_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'committed', updated_at TEXT NOT NULL DEFAULT '')")
    const bindingColumns = this.#sessionIndex.query("PRAGMA table_info(bindings)").all() as Array<{ name: string }>
    if (!bindingColumns.some((column) => column.name === "state")) this.#sessionIndex.run("ALTER TABLE bindings ADD COLUMN state TEXT NOT NULL DEFAULT 'committed'")
    if (!bindingColumns.some((column) => column.name === "updated_at")) this.#sessionIndex.run("ALTER TABLE bindings ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
  }

  get root() {
    return this.#root
  }

  directory(id: string) {
    return path.join(this.#root, operationID(id))
  }

  async create(record: OperationRecord): Promise<OperationRecord> {
    const id = operationID(record.id)
    if (record.id !== id) throw new Error("operation record id is not normalized")
    if (existsSync(path.join(this.directory(id), "operation.db"))) {
      const db = this.#database(id)
      const created = db.query("SELECT record_json FROM operation_events WHERE type = 'operation.created' ORDER BY seq LIMIT 1").get() as { record_json: string } | null
      const existing = await this.get(id)
      if (existing) {
        if (created && createIdentity(JSON.parse(created.record_json) as OperationRecord) === createIdentity(record)) return existing
        throw new OperationConflictError(`operation already exists with different create input: ${id}`)
      }
    }
    const claimedSessions: string[] = []
    try {
      for (const boundSession of record.sessionIDs) {
        await this.#claimSession(id, boundSession)
        claimedSessions.push(boundSession)
      }
    } catch (error) {
      this.#releaseSessions(id, claimedSessions)
      throw error
    }
    const directory = this.directory(id)
    mkdirSync(directory, { recursive: true })
    const db = this.#database(id)
    const initial = structuredClone(record)
    initial.revision = 0
    const now = initial.createdAt
    const data = { record: initial }
    const commit = db.transaction(() => {
      if (db.query("SELECT id FROM operation_snapshot WHERE id = ?").get(id)) {
        throw new OperationConflictError(`operation already exists: ${id}`)
      }
      db.query("INSERT INTO operation_snapshot (id, revision, record_json) VALUES (?, ?, ?)").run(id, 0, JSON.stringify(initial))
      db.query(
        "INSERT INTO operation_events (seq, revision, at, type, idempotency_key, actor_json, data_json, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(0, 0, now, "operation.created", `create:${id}`, JSON.stringify({ kind: "operator" }), JSON.stringify(data), JSON.stringify(initial))
      for (const boundSession of initial.sessionIDs) this.#bindInTransaction(db, id, boundSession)
    })
    try {
      commit.immediate()
      this.#confirmSessions(id, record.sessionIDs)
    } catch (error) {
      this.#releaseSessions(id, record.sessionIDs)
      throw error
    }
    this.#writeProjection(id, initial)
    return initial
  }

  async get(id: string): Promise<OperationRecord | undefined> {
    const normalized = operationID(id)
    if (!existsSync(path.join(this.directory(normalized), "operation.db"))) return undefined
    const db = this.#database(normalized)
    const snapshot = db.query("SELECT revision, record_json FROM operation_snapshot WHERE id = ?").get(normalized) as SnapshotRow | null
    const latest = db.query("SELECT revision, record_json FROM operation_events ORDER BY seq DESC LIMIT 1").get() as SnapshotRow | null
    if (!latest) return undefined
    let record: OperationRecord
    record = JSON.parse(latest.record_json) as OperationRecord
    if (!snapshot || snapshot.revision !== latest.revision || snapshot.record_json !== latest.record_json) {
      db.query("INSERT OR REPLACE INTO operation_snapshot (id, revision, record_json) VALUES (?, ?, ?)").run(
        normalized,
        record.revision,
        JSON.stringify(record),
      )
    } else {
      record = JSON.parse(snapshot.record_json) as OperationRecord
    }
    this.#writeProjection(normalized, record)
    return record
  }

  async list(): Promise<OperationRecord[]> {
    const entries = readdirSync(this.#root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    const records = await Promise.all(entries.map((entry) => this.get(entry.name)))
    return records.filter((record): record is OperationRecord => record !== undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async forSession(id: string): Promise<OperationRecord | undefined> {
    const requested = sessionID(id)
    const indexed = this.#sessionIndex.query("SELECT operation_id, state, updated_at FROM bindings WHERE session_id = ?").get(requested) as
      | { operation_id: string; state: string; updated_at: string }
      | null
    if (indexed) {
      const record = await this.get(indexed.operation_id)
      if (record?.sessionIDs.includes(requested)) {
        this.#confirmSessions(indexed.operation_id, [requested])
        return record
      }
      const age = Date.now() - Date.parse(indexed.updated_at)
      if (indexed.state === "pending" && (!Number.isFinite(age) || age < 60_000)) return undefined
      this.#releaseSessions(indexed.operation_id, [requested])
    }
    const matches = (await this.list()).filter((record) => record.sessionIDs.includes(requested))
    if (matches.length > 1) throw new OperationConflictError(`session ${requested} is bound to multiple operations`)
    if (matches[0]) await this.#claimSession(matches[0].id, requested)
    return matches[0]
  }

  async bindSession(id: string, value: string): Promise<OperationRecord> {
    const normalized = operationID(id)
    const boundSession = sessionID(value)
    const record = await this.#require(normalized)
    if (record.sessionIDs.includes(boundSession)) return record
    await this.#claimSession(normalized, boundSession)
    const updated = { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), sessionIDs: [...record.sessionIDs, boundSession] }
    const result = await this.commit({
      operationID: normalized,
      expectedRevision: record.revision,
      type: "session.bound",
      idempotencyKey: `session.bound:${boundSession}`,
      actor: { kind: "operator" },
      data: { sessionID: boundSession },
      operation: updated,
    })
    this.#confirmSessions(normalized, [boundSession])
    return result.operation
  }

  async events(id: string, afterSeq = -1): Promise<OperationEvent[]> {
    const normalized = operationID(id)
    if (!existsSync(path.join(this.directory(normalized), "operation.db"))) return []
    const db = this.#database(normalized)
    const rows = db.query("SELECT * FROM operation_events WHERE seq > ? ORDER BY seq").all(afterSeq) as EventRow[]
    return rows.map((row) => ({
      operationID: normalized,
      seq: row.seq,
      revision: row.revision,
      at: row.at,
      type: row.type,
      idempotencyKey: row.idempotency_key,
      actor: JSON.parse(row.actor_json) as OperationEvent["actor"],
      data: JSON.parse(row.data_json) as unknown,
    }))
  }

  async commit(input: StoreCommitInput): Promise<StoreCommitResult> {
    const id = operationID(input.operationID)
    const binding = input.type === "session.bound" ? (input.data as { sessionID: string }).sessionID : undefined
    if (binding) await this.#claimSession(id, binding)
    const db = this.#database(id)
    const operation = structuredClone(input.operation)
    if (operation.id !== id) throw new Error("committed operation id does not match store key")
    if (operation.revision !== input.expectedRevision + 1) throw new Error("committed revision must increase by exactly one")
    const result = db.transaction(() => {
      const prior = db.query("SELECT idempotency_key, type, actor_json, data_json, record_json FROM operation_events WHERE idempotency_key = ?").get(input.idempotencyKey) as
        | { idempotency_key: string; type: string; actor_json: string; data_json: string; record_json: string }
        | null
      if (prior) {
        if (
          prior.type !== input.type ||
          prior.actor_json !== JSON.stringify(input.actor) ||
          prior.data_json !== JSON.stringify(input.data)
        ) throw new OperationConflictError("idempotency key was reused with a different event")
        return { operation: JSON.parse(prior.record_json) as OperationRecord, replayed: true }
      }
      const current = db.query("SELECT revision, record_json FROM operation_snapshot WHERE id = ?").get(id) as { revision: number; record_json: string } | null
      if (!current) throw new Error(`operation does not exist: ${id}`)
      if (current.revision !== input.expectedRevision) {
        throw new OperationConflictError(`stale operation revision ${input.expectedRevision}; current revision is ${current.revision}`)
      }
      const previous = JSON.parse(current.record_json) as OperationRecord
      let next = operation
      if (previous.goal.status === "complete") {
        const blockers = ["operation changed after completion; regenerate the final package and audit"]
        next = {
          ...operation,
          status: "blocked",
          goal: { ...operation.goal, status: "active", completion: { checkedAt: operation.updatedAt, blockers } },
          audit: { status: "blocked", checkedAt: operation.updatedAt, blockers, recordRevision: operation.revision },
        }
        if (input.type !== "report.registered") {
          next.reportSourceRevision = undefined
          next.reportSourceDigest = undefined
        }
      }
      if (input.type === "session.bound") {
        const data = input.data as { sessionID: string }
        this.#bindInTransaction(db, id, data.sessionID)
      }
      const seq = db.query("SELECT COALESCE(MAX(seq), -1) + 1 AS seq FROM operation_events").get() as { seq: number }
      const at = next.updatedAt
      const dataJSON = JSON.stringify(input.data)
      const recordJSON = JSON.stringify(next)
      db.query(
        "INSERT INTO operation_events (seq, revision, at, type, idempotency_key, actor_json, data_json, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(seq.seq, operation.revision, at, input.type, input.idempotencyKey, JSON.stringify(input.actor), dataJSON, recordJSON)
      db.query("UPDATE operation_snapshot SET revision = ?, record_json = ? WHERE id = ?").run(operation.revision, recordJSON, id)
      return { operation: next, replayed: false }
    })
    let committed: StoreCommitResult
    try {
      committed = result.immediate()
      if (binding) this.#confirmSessions(id, [binding])
    } catch (error) {
      if (binding) await this.#releaseIfUnbound(id, binding)
      throw error
    }
    if (!committed.replayed) this.#writeProjection(id, committed.operation)
    return committed
  }

  async close() {
    for (const db of this.#databases.values()) db.close()
    this.#databases.clear()
    this.#sessionIndex.close()
  }

  async #require(id: string) {
    const record = await this.get(id)
    if (!record) throw new Error(`operation does not exist: ${id}`)
    return record
  }

  #bindInTransaction(db: Database, id: string, value: string) {
    const boundSession = sessionID(value)
    db.query("INSERT OR IGNORE INTO operation_sessions (session_id, operation_id) VALUES (?, ?)").run(boundSession, id)
  }

  async #claimSession(id: string, value: string) {
    const boundSession = sessionID(value)
    const existing = this.#sessionIndex.query("SELECT operation_id, state, updated_at FROM bindings WHERE session_id = ?").get(boundSession) as
      | { operation_id: string; state: string; updated_at: string }
      | null
    if (existing && existing.operation_id !== id) {
      const record = await this.get(existing.operation_id)
      if (record?.sessionIDs.includes(boundSession)) {
        throw new OperationConflictError(`session is already bound to operation ${existing.operation_id}`)
      }
      const age = Date.now() - Date.parse(existing.updated_at)
      if (existing.state === "pending" && (!Number.isFinite(age) || age < 60_000)) {
        throw new OperationConflictError(`session is reserved by operation ${existing.operation_id}; retry after its binding is reconciled`)
      }
      this.#releaseSessions(existing.operation_id, [boundSession])
    }
    const claim = this.#sessionIndex.transaction(() => {
      const current = this.#sessionIndex.query("SELECT operation_id FROM bindings WHERE session_id = ?").get(boundSession) as { operation_id: string } | null
      if (current && current.operation_id !== id) throw new OperationConflictError(`session is already bound to operation ${current.operation_id}`)
      this.#sessionIndex.query("INSERT OR REPLACE INTO bindings (session_id, operation_id, state, updated_at) VALUES (?, ?, 'pending', ?)").run(boundSession, id, new Date().toISOString())
    })
    claim.immediate()
  }

  #releaseSessions(id: string, values: string[]) {
    const remove = this.#sessionIndex.query("DELETE FROM bindings WHERE operation_id = ? AND session_id = ?")
    const clear = this.#sessionIndex.transaction(() => values.forEach((value) => remove.run(id, value)))
    clear.immediate()
  }

  #confirmSessions(id: string, values: string[]) {
    const update = this.#sessionIndex.query("UPDATE bindings SET state = 'committed', updated_at = ? WHERE operation_id = ? AND session_id = ?")
    const now = new Date().toISOString()
    for (const value of values) update.run(now, id, value)
  }

  async #releaseIfUnbound(id: string, value: string) {
    const record = await this.get(id)
    if (record?.sessionIDs.includes(value)) {
      await this.#claimSession(id, value)
      return
    }
    this.#releaseSessions(id, [value])
  }

  #database(id: string) {
    const normalized = operationID(id)
    const cached = this.#databases.get(normalized)
    if (cached) return cached
    const directory = this.directory(normalized)
    mkdirSync(directory, { recursive: true })
    const db = new Database(path.join(directory, "operation.db"), { create: true, readwrite: true })
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA foreign_keys = ON")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("CREATE TABLE IF NOT EXISTS operation_snapshot (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, record_json TEXT NOT NULL)")
    db.run("CREATE TABLE IF NOT EXISTS operation_sessions (session_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL)")
    db.run(
      "CREATE TABLE IF NOT EXISTS operation_events (seq INTEGER PRIMARY KEY, revision INTEGER NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, actor_json TEXT NOT NULL, data_json TEXT NOT NULL, record_json TEXT NOT NULL)",
    )
    this.#databases.set(normalized, db)
    return db
  }

  #writeProjection(id: string, record: OperationRecord) {
    const directory = this.directory(id)
    const target = path.join(directory, "operation.json")
    const temporary = `${target}.${crypto.randomUUID()}.tmp`
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, target)
  }
}
