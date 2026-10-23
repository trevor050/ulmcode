import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { operationID } from "./operation.js"

export type CredentialHandle = `cred_${string}`

export type CredentialStatus = "needs_review" | "approved" | "reauth_required"

export type CredentialMetadata = {
  credentialID: CredentialHandle
  status: CredentialStatus
  usePolicy: {
    authorizedTargets: string[]
    reviewedAt?: string
  }
}

export type PrivateCredential = {
  label?: string
  type?: string
  username?: string
  password?: string
  secret?: string
  url?: string
  target?: string
  tags?: string[]
  notes?: string
  rules?: string
  source?: Record<string, unknown>
}

type CredentialIndex = { schemaVersion: 1; operationID: string; credentials: CredentialMetadata[] }

const locks = new Map<string, Promise<void>>()

export async function storeCredential(input: {
  credentialsDir: string
  operationRoot: string
  operationID: string
  credential?: CredentialHandle
  value: PrivateCredential
}) {
  const operation = operationID(input.operationID)
  const credentialID = input.credential ?? (`cred_${randomUUID()}` as CredentialHandle)
  const indexFile = path.join(input.operationRoot, "credentials", "index.json")
  return withLock(indexFile, async () => {
    const index = await readIndex(indexFile, operation)
    if (index.credentials.some((entry) => entry.credentialID === credentialID)) {
      const current = await readPrivate(input.credentialsDir, operation, credentialID)
      if (JSON.stringify(current) !== JSON.stringify(input.value)) throw new Error("credential handle already exists")
      return publicRecord(index, credentialID)
    }

    const record: CredentialMetadata = { credentialID, status: "needs_review", usePolicy: { authorizedTargets: [] } }
    await writePrivate(input.credentialsDir, operation, credentialID, input.value)
    await writeIndex(indexFile, { ...index, credentials: [...index.credentials, record] })
    return record
  })
}

export async function listCredentials(operationRoot: string, rawOperationID: string) {
  const operation = operationID(rawOperationID)
  return (await readIndex(path.join(operationRoot, "credentials", "index.json"), operation)).credentials
}

export async function reviewCredential(input: {
  credentialsDir: string
  operationRoot: string
  operationID: string
  credentialID: CredentialHandle
  reviewedBy: string
  authorizedTargets: string[]
}) {
  const operation = operationID(input.operationID)
  const reviewer = input.reviewedBy.trim()
  const targets = [...new Set(input.authorizedTargets.map((target) => target.trim()).filter(Boolean))]
  if (!reviewer || targets.length === 0) throw new Error("credential review requires a reviewer and authorized target")
  const indexFile = path.join(input.operationRoot, "credentials", "index.json")
  return withLock(indexFile, async () => {
    const index = await readIndex(indexFile, operation)
    const current = index.credentials.find((entry) => entry.credentialID === input.credentialID)
    if (!current) throw new Error("credential handle not found")
    if (current.status === "reauth_required") throw new Error("credential requires re-authentication")
    const updated: CredentialMetadata = {
      ...current,
      status: "approved",
      usePolicy: { authorizedTargets: targets, reviewedAt: new Date().toISOString() },
    }
    await writeIndex(indexFile, {
      ...index,
      credentials: index.credentials.map((entry) => (entry.credentialID === current.credentialID ? updated : entry)),
    })
    return updated
  })
}

export async function materializeCredential(input: {
  credentialsDir: string
  operationRoot: string
  operationID: string
  credentialID: CredentialHandle
  target: string
  executionID: string
}) {
  const operation = operationID(input.operationID)
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.executionID)) throw new Error("credential materialization requires an execution id")
  const record = (await readIndex(path.join(input.operationRoot, "credentials", "index.json"), operation)).credentials.find(
    (entry) => entry.credentialID === input.credentialID,
  )
  if (!record || record.status !== "approved" || !record.usePolicy.authorizedTargets.includes(input.target))
    throw new Error("credential is not reviewed for this target")
  const value = await readPrivate(input.credentialsDir, operation, input.credentialID)
  await recordUsage(input.operationRoot, {
    credentialID: input.credentialID,
    target: input.target,
    executionID: input.executionID,
    usedAt: new Date().toISOString(),
  })
  const prefix = `ULMCODE_CREDENTIAL_${input.credentialID.slice(5).toUpperCase()}`
  return Object.fromEntries(
    Object.entries({
      [`${prefix}_USERNAME`]: value.username,
      [`${prefix}_PASSWORD`]: value.password,
      [`${prefix}_SECRET`]: value.secret ?? value.password,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

export async function requireReauthentication(input: {
  credentialsDir: string
  operationRoot: string
  operationID: string
  credentialID: CredentialHandle
  value?: PrivateCredential
}) {
  const operation = operationID(input.operationID)
  const indexFile = path.join(input.operationRoot, "credentials", "index.json")
  return withLock(indexFile, async () => {
    const index = await readIndex(indexFile, operation)
    const existing = index.credentials.find((entry) => entry.credentialID === input.credentialID)
    if (existing) return existing
    if (!existing) {
      if (input.value) await writePrivate(input.credentialsDir, operation, input.credentialID, input.value)
      const record: CredentialMetadata = {
        credentialID: input.credentialID,
        status: "reauth_required",
        usePolicy: { authorizedTargets: [] },
      }
      await writeIndex(indexFile, { ...index, credentials: [...index.credentials, record] })
      return record
    }
  })
}

export async function reauthorizeCredential(input: {
  credentialsDir: string
  operationRoot: string
  operationID: string
  credentialID: CredentialHandle
  value: PrivateCredential
}) {
  const operation = operationID(input.operationID)
  const indexFile = path.join(input.operationRoot, "credentials", "index.json")
  return withLock(indexFile, async () => {
    const index = await readIndex(indexFile, operation)
    const current = index.credentials.find((entry) => entry.credentialID === input.credentialID)
    if (!current || current.status !== "reauth_required") throw new Error("credential does not require re-authentication")
    await writePrivate(input.credentialsDir, operation, input.credentialID, input.value)
    const updated: CredentialMetadata = { ...current, status: "needs_review", usePolicy: { authorizedTargets: [] } }
    await writeIndex(indexFile, {
      ...index,
      credentials: index.credentials.map((entry) => (entry.credentialID === current.credentialID ? updated : entry)),
    })
    return updated
  })
}

async function readIndex(file: string, id: string): Promise<CredentialIndex> {
  if (!(await Bun.file(file).exists())) return { schemaVersion: 1, operationID: id, credentials: [] }
  const value = await Bun.file(file).json()
  if (!value || value.schemaVersion !== 1 || value.operationID !== id || !Array.isArray(value.credentials))
    throw new Error("credential index is invalid")
  return value as CredentialIndex
}

async function writeIndex(file: string, value: CredentialIndex) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.chmod(path.dirname(file), 0o700)
  await atomicWrite(file, JSON.stringify(value, null, 2) + "\n", 0o600)
}

async function writePrivate(root: string, operation: string, credentialID: CredentialHandle, value: PrivateCredential) {
  const directory = path.join(root, operation)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await fs.chmod(directory, 0o700)
  await atomicWrite(privatePath(root, operation, credentialID), JSON.stringify(value, null, 2) + "\n", 0o600)
}

async function recordUsage(
  operationRoot: string,
  usage: { credentialID: CredentialHandle; target: string; executionID: string; usedAt: string },
) {
  const directory = path.join(operationRoot, "credentials")
  const file = path.join(directory, "usage.jsonl")
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await fs.chmod(directory, 0o700)
  const existing = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (existing?.isSymbolicLink()) throw new Error("credential usage log cannot be a symbolic link")
  await fs.writeFile(file, `${JSON.stringify(usage)}\n`, { flag: "a", mode: 0o600 })
  await fs.chmod(file, 0o600)
}

async function readPrivate(root: string, operation: string, credentialID: CredentialHandle): Promise<PrivateCredential> {
  return (await Bun.file(privatePath(root, operation, credentialID)).json()) as PrivateCredential
}

function privatePath(root: string, operation: string, credentialID: CredentialHandle) {
  if (!/^cred_[a-zA-Z0-9_-]{1,96}$/.test(credentialID)) throw new Error("credential handle is invalid")
  return path.join(root, operation, `${credentialID}.json`)
}

async function atomicWrite(file: string, contents: string, mode: number) {
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, contents, { mode, flag: "wx" })
  await fs.chmod(temporary, mode)
  await fs.rename(temporary, file)
}

async function withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release = () => {}
  const current = new Promise<void>((resolve) => (release = resolve))
  const tail = previous.then(() => current)
  locks.set(key, tail)
  await previous
  try {
    const releaseFileLock = await acquireFileLock(`${key}.lock`)
    try {
      return await run()
    } finally {
      await releaseFileLock()
    }
  } finally {
    release()
    if (locks.get(key) === tail) locks.delete(key)
  }
}

async function acquireFileLock(file: string) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.chmod(path.dirname(file), 0o700)
  const token = randomUUID()
  const started = Date.now()
  while (true) {
    try {
      const handle = await fs.open(file, "wx", 0o600)
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() }))
      await handle.close()
      return async () => {
        const current = await Bun.file(file).json().catch(() => undefined)
        if (current?.token === token) await fs.unlink(file).catch(() => {})
      }
    } catch (error) {
      const cause = error as NodeJS.ErrnoException
      if (cause.code !== "EEXIST") throw error
    }

    const info = await fs.stat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (info && Date.now() - info.mtimeMs > 30_000) {
      const owner = await Bun.file(file).json().catch(() => undefined)
      const ownerPID = typeof owner?.pid === "number" ? owner.pid : undefined
      if (!ownerPID || !isProcessAlive(ownerPID)) {
        await fs.unlink(file).catch(() => {})
        continue
      }
    }
    if (Date.now() - started > 60_000) throw new Error("timed out waiting for credential index lock")
    await Bun.sleep(10 + Math.floor(Math.random() * 20))
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

function publicRecord(index: CredentialIndex, credentialID: CredentialHandle) {
  const record = index.credentials.find((entry) => entry.credentialID === credentialID)
  if (!record) throw new Error("credential handle not found")
  return record
}

export * as Credentials from "./credentials.js"
