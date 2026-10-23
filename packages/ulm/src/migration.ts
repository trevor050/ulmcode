import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { operationID } from "./operation.js"
import { OperationStore } from "./store.js"
import type { OperationRecord, OperationPlan } from "./operation.js"
import { listCredentials, requireReauthentication, storeCredential, type PrivateCredential } from "./credentials.js"

export type MigrationInput = {
  sourceOperationsRoot: string
  sourceStorageRoot: string
  targetOperationsRoot: string
  targetWorkspaceRoot: string
  targetCredentialsDir: string
}

export type MigrationPlan = MigrationInput & {
  version: 1
  planID: string
  operationCount: number
  importableOperationCount: number
  quarantinedOperationCount: number
  fileCount: number
  credentialCount: number
  reauthenticationCount: number
  operations: Array<{
    operationID: string
    disposition: "import" | "quarantine"
    reason?: string
    credentialIndex?: { sha256: string; size: number }
    files: Array<{ path: string; sha256: string; size: number; disposition: "public" | "quarantined"; reason?: string }>
    credentials: Array<{ credentialID: string; handle: `cred_${string}`; status: "available" | "reauth_required"; sourceSecretSha256?: string }>
  }>
}

type PlannedOperation = {
    id: string
    files: Array<{
      relativePath: string
      sha256: string
      size: number
      disposition: "public" | "quarantined"
      quarantineReason?: string
    }>
    legacyCredentialIndex?: { sha256: string; size: number }
    legacyCredentialsMalformed?: boolean
    record?: OperationRecord
    quarantineReason?: string
    credentials: Array<{
      credentialID: string
      handle: `cred_${string}`
      status: "available" | "reauth_required"
      legacySecret?: { relativePath: string; sha256: string }
    }>
}

type PlannedCredential = PlannedOperation["credentials"][number]

type LegacyCredential = Record<string, unknown> & { credentialID: string }

export async function planMigration(input: MigrationInput): Promise<MigrationPlan> {
  return (await createPlan(input)).summary
}

async function createPlan(input: MigrationInput) {
  const sourceOperationsRoot = path.resolve(input.sourceOperationsRoot)
  const sourceStorageRoot = path.resolve(input.sourceStorageRoot)
  const targetOperationsRoot = path.resolve(input.targetOperationsRoot)
  const targetWorkspaceRoot = path.resolve(input.targetWorkspaceRoot)
  const targetCredentialsDir = path.resolve(input.targetCredentialsDir)
  const sourceRoots = [sourceOperationsRoot, sourceStorageRoot]
  const destinationRoots = [targetWorkspaceRoot, targetOperationsRoot, targetCredentialsDir]
  if (sourceRoots.some((source) => destinationRoots.some((target) => overlaps(source, target))))
    throw new Error("migration source and destination roots must be separate")
  if (path.resolve(targetOperationsRoot) !== path.join(targetWorkspaceRoot, ".ulmcode", "operations"))
    throw new Error("target operations root must belong to the explicit target workspace")

  await Promise.all([...sourceRoots, ...destinationRoots].map(assertNoSymlinkPath))
  const entries = await fs.readdir(sourceOperationsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  if (entries.some((item) => item.isSymbolicLink())) throw new Error("migration does not follow symbolic links")
  const operations: PlannedOperation[] = []
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error("migration does not follow symbolic links")
    const id = operationID(entry.name)
    const directory = path.join(sourceOperationsRoot, entry.name)
    const allFiles = await listFiles(directory)
    const legacyIndex = allFiles.find((item) => item.relativePath === "credentials/index.json")
    let files: PlannedOperation["files"] = await Promise.all(
      allFiles
        .filter((item) => item.relativePath !== "credentials/index.json")
        .map(async (item) => {
          const bytes = await fs.readFile(path.join(directory, item.relativePath))
          return { relativePath: item.relativePath, sha256: sha256(bytes), size: bytes.byteLength, disposition: "quarantined" as const }
        }),
    )
    const credentials: PlannedCredential[] = []
    const legacyRecords: LegacyCredential[] = []
    const legacySecretRecords: Record<string, unknown>[] = []
    let legacyCredentialIndex: PlannedOperation["legacyCredentialIndex"]
    let legacyCredentialsMalformed = false
    if (legacyIndex) {
      const bytes = await fs.readFile(path.join(directory, legacyIndex.relativePath))
      const decoded = safeDecodeLegacyIndex(bytes, id)
      if (!decoded) legacyCredentialsMalformed = true
      const records = decoded ?? []
      legacyRecords.push(...records)
      legacyCredentialIndex = { sha256: sha256(bytes), size: bytes.byteLength }
      const grouped = groupBy(records, (record) => legacySlug(record.credentialID))
      for (const record of records) {
        const slug = legacySlug(record.credentialID)
        const credentialBytes = await readSourceStorageFile(
          sourceStorageRoot,
          path.join("storage", "ulm", "credential", legacySlug(id), `${slug}.json`),
        )
        const ambiguous = (grouped.get(slug)?.length ?? 0) > 1
        const credentialValue = credentialBytes ? parseLegacySecret(credentialBytes) : undefined
        if (credentialValue) legacySecretRecords.push({ ...credentialValue })
        credentials.push({
          credentialID: record.credentialID,
          handle: handleFor(id, record.credentialID),
          status: credentialValue && !ambiguous ? "available" : "reauth_required",
          ...(credentialBytes && {
            legacySecret: {
              relativePath: path.join("storage", "ulm", "credential", legacySlug(id), `${slug}.json`),
              sha256: sha256(credentialBytes),
            },
          }),
        })
      }
    }
    const legacyOperationBytes = await fs.readFile(path.join(directory, "operation.json")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    const legacyPlanBytes = await fs.readFile(path.join(directory, "plans", "operation-plan.json")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    const legacyGoalBytes =
      (await fs.readFile(path.join(directory, "goals", "operation-goal.json")).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })) ??
      (await fs.readFile(path.join(directory, "goals", "goal.json")).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      }))
    const sensitiveValues = [...credentialValues(legacyRecords), ...credentialValues(legacySecretRecords)]
    const legacyOperation = legacyOperationBytes && parseLegacyOperation(legacyOperationBytes, id)
    const legacyPlan = legacyPlanBytes && parseLegacyPlan(legacyPlanBytes, id)
    const legacyGoal = legacyGoalBytes && parseLegacyGoal(legacyGoalBytes, id)
    const quarantineReason = legacyCredentialsMalformed
      ? "legacy credential index is malformed"
      : !legacyOperationBytes
      ? "legacy operation.json is missing"
      : !legacyOperation
        ? "legacy operation.json is malformed or does not match the directory id"
        : legacyPlanBytes && !legacyPlan
          ? "legacy operation plan is malformed or does not match the directory id"
          : legacyGoalBytes && !legacyGoal
            ? "legacy operation goal is malformed or does not match the directory id"
        : [legacyOperationBytes, legacyPlanBytes, legacyGoalBytes].some(
            (bytes) => bytes !== undefined && containsCredentialMaterial(new TextDecoder().decode(bytes), sensitiveValues),
          )
          ? "legacy operation metadata contains credential material"
          : undefined
    files = await Promise.all(
      files.map(async (file) => {
        const bytes = await fs.readFile(path.join(directory, file.relativePath))
        return {
          ...file,
          ...(quarantineReason
            ? { disposition: "quarantined" as const, quarantineReason }
            : !isAllowedPublicFile(file.relativePath)
              ? { disposition: "quarantined" as const, quarantineReason: "file path is outside the public migration allowlist" }
              : containsCredentialMaterial(bytes.toString(), sensitiveValues)
                ? { disposition: "quarantined" as const, quarantineReason: "file contains credential material" }
                : { disposition: "public" as const }),
        }
      }),
    )
    const mappedRecord = legacyOperation && !quarantineReason
      ? mapLegacyOperation({ id, operation: legacyOperation, plan: legacyPlan, goal: legacyGoal, files })
      : undefined
    const finalQuarantineReason = mappedRecord && containsCredentialMaterial(JSON.stringify(mappedRecord), sensitiveValues)
      ? "mapped legacy operation contains credential material"
      : quarantineReason
    operations.push({
      id,
      files: finalQuarantineReason
        ? files.map((file) => ({ ...file, disposition: "quarantined" as const, quarantineReason: finalQuarantineReason }))
        : files,
      legacyCredentialIndex,
      legacyCredentialsMalformed,
      credentials,
      record: finalQuarantineReason ? undefined : mappedRecord,
      quarantineReason: finalQuarantineReason,
    })
  }

  const summary = {
    version: 1 as const,
    sourceOperationsRoot,
    sourceStorageRoot,
    targetOperationsRoot,
    targetWorkspaceRoot,
    targetCredentialsDir,
    operationCount: operations.length,
    importableOperationCount: operations.filter((operation) => operation.record).length,
    quarantinedOperationCount: operations.filter((operation) => !operation.record).length,
    fileCount: operations.reduce((total, operation) => total + operation.files.length + Number(Boolean(operation.legacyCredentialIndex)), 0),
    credentialCount: operations.reduce((total, operation) => total + operation.credentials.length, 0),
    reauthenticationCount: operations.reduce(
      (total, operation) => total + operation.credentials.filter((credential) => credential.status === "reauth_required").length,
      0,
    ),
    operations: operations.map((operation) => ({
      operationID: operation.id,
      disposition: operation.record ? ("import" as const) : ("quarantine" as const),
      ...(operation.quarantineReason ? { reason: operation.quarantineReason } : {}),
      ...(operation.legacyCredentialIndex ? { credentialIndex: operation.legacyCredentialIndex } : {}),
      files: operation.files.map((file) => ({
        path: file.relativePath,
        sha256: file.sha256,
        size: file.size,
        disposition: file.disposition,
        ...(file.quarantineReason ? { reason: file.quarantineReason } : {}),
      })),
      credentials: operation.credentials.map(({ credentialID, handle, status, legacySecret }) => ({
        credentialID,
        handle,
        status,
        ...(legacySecret ? { sourceSecretSha256: legacySecret.sha256 } : {}),
      })),
    })),
  }
  return { summary: { ...summary, planID: sha256(JSON.stringify({ ...summary, operations })) }, operations }
}

export async function applyMigration(plan: MigrationPlan) {
  const current = await createPlan(plan)
  if (JSON.stringify(current.summary) !== JSON.stringify(plan)) throw new Error("migration source changed after planning")
  await preflightCredentialDestinations(current.operations, plan)
  await preflightPublicDestinations(current.operations, plan)
  let copiedFiles = 0
  let copiedCredentials = 0
  let importedOperations = 0
  let quarantinedOperations = 0
  const quarantined: Array<{ operationID: string; reason: string }> = []
  const store = new OperationStore({ workspaceRoot: plan.targetWorkspaceRoot })
  for (const operation of current.operations) {
    const sourceDirectory = path.join(plan.sourceOperationsRoot, operation.id)
    const targetDirectory = path.join(plan.targetOperationsRoot, operation.id)
    const archiveDirectory = path.join(plan.targetCredentialsDir, operation.id, "quarantine", "legacy-operation")
    const archivedFiles: Array<{ path: string; sha256: string; size: number; disposition: "public" | "quarantined"; reason?: string }> = []
    for (const file of operation.files) {
      const source = path.join(sourceDirectory, file.relativePath)
      const bytes = await fs.readFile(source)
      if (sha256(bytes) !== file.sha256) throw new Error("migration source changed after planning")
      const archivedPath = `${sha256(file.relativePath)}.bin`
      await writeOnce(path.join(archiveDirectory, archivedPath), bytes, 0o600, plan.targetCredentialsDir)
      archivedFiles.push({
        path: file.relativePath,
        sha256: file.sha256,
        size: file.size,
        disposition: file.disposition,
        ...(file.quarantineReason ? { reason: file.quarantineReason } : {}),
      })
      if (file.disposition === "public" && operation.record && file.relativePath !== "plans/operation-plan.json") {
        await writeOnce(path.join(targetDirectory, file.relativePath), bytes, 0o600, plan.targetOperationsRoot)
      }
      copiedFiles++
    }
    await writeOnce(
      path.join(archiveDirectory, "manifest.json"),
      Buffer.from(JSON.stringify({ schemaVersion: 1, operationID: operation.id, reason: operation.quarantineReason, files: archivedFiles }, null, 2) + "\n"),
      0o600,
      plan.targetCredentialsDir,
    )
    if (operation.record) {
      const planArtifact = operation.record.plan
      if (planArtifact) {
        const safePlan = { ...planArtifact, approvedAt: undefined, approvedBy: undefined }
        await writeOnce(
          path.join(targetDirectory, "plans", "operation-plan.json"),
          Buffer.from(JSON.stringify(safePlan, null, 2) + "\n"),
          0o600,
          plan.targetOperationsRoot,
        )
      }
      const existing = await store.get(operation.id)
      if (!existing) await store.create(operation.record)
      else if (JSON.stringify(existing) !== JSON.stringify(operation.record))
        throw new Error("migration destination contains a different operation")
      importedOperations++
    } else {
      quarantinedOperations++
      quarantined.push({ operationID: operation.id, reason: operation.quarantineReason ?? "legacy operation could not be imported" })
    }
    if (!operation.legacyCredentialIndex) continue

    const legacyIndexPath = path.join(sourceDirectory, "credentials", "index.json")
    const legacyIndexBytes = await fs.readFile(legacyIndexPath)
    if (sha256(legacyIndexBytes) !== operation.legacyCredentialIndex.sha256)
      throw new Error("migration source changed after planning")
    const quarantineDir = path.join(plan.targetCredentialsDir, operation.id, "quarantine")
    await writeOnce(path.join(quarantineDir, "legacy-index.json"), legacyIndexBytes, 0o600, plan.targetCredentialsDir)
    if (operation.legacyCredentialsMalformed) continue
    const records = decodeLegacyIndex(legacyIndexBytes, operation.id)
    const grouped = groupBy(records, (record) => legacySlug(record.credentialID))
    for (const record of records) {
      const handle = handleFor(operation.id, record.credentialID)
      const slug = legacySlug(record.credentialID)
      const ambiguous = (grouped.get(slug)?.length ?? 0) > 1
      const plannedCredential = operation.credentials.find((item) => item.credentialID === record.credentialID)
      if (!plannedCredential) throw new Error("migration plan is invalid")
      const legacySecretPath = path.join(
        plan.sourceStorageRoot,
        "storage",
        "ulm",
        "credential",
        legacySlug(operation.id),
        `${slug}.json`,
      )
      const legacySecretBytes = await readSourceStorageFile(
        plan.sourceStorageRoot,
        path.relative(plan.sourceStorageRoot, legacySecretPath),
      )
      if (
        (plannedCredential.legacySecret &&
          (!legacySecretBytes || sha256(legacySecretBytes) !== plannedCredential.legacySecret.sha256)) ||
        (!plannedCredential.legacySecret && legacySecretBytes)
      )
        throw new Error("migration source changed after planning")
      if (legacySecretBytes) {
        await writeOnce(path.join(quarantineDir, `${hashID(operation.id, legacySecretPath)}.json`), legacySecretBytes, 0o600, plan.targetCredentialsDir)
      }
      const secretValue = legacySecretBytes ? parseLegacySecret(legacySecretBytes) : undefined
      const privateValue = {
        label: stringValue(record.label),
        type: stringValue(record.type),
        username: stringValue(record.username),
        url: stringValue(record.url),
        target: stringValue(record.target),
        tags: stringArray(record.tags),
        notes: stringValue(record.notes),
        rules: stringValue(record.rules),
        source: record,
        ...secretValue,
      } satisfies PrivateCredential
      const operationRoot = path.join(targetDirectory)
      if (!secretValue || ambiguous) {
        await requireReauthentication({
          credentialsDir: plan.targetCredentialsDir,
          operationRoot,
          operationID: operation.id,
          credentialID: handle,
          value: privateValue,
        })
      } else {
        await storeCredential({
          credentialsDir: plan.targetCredentialsDir,
          operationRoot,
          operationID: operation.id,
          credential: handle,
          value: privateValue,
        })
      }
      copiedCredentials++
    }
  }
  await store.close()
  return {
    planID: plan.planID,
    copiedFiles,
    copiedCredentials,
    importedOperations,
    quarantinedOperations,
    quarantined,
    reauthenticationRequired: plan.reauthenticationCount,
  }
}

async function preflightPublicDestinations(operations: PlannedOperation[], plan: MigrationPlan) {
  const store = new OperationStore({ workspaceRoot: plan.targetWorkspaceRoot })
  try {
    for (const operation of operations) {
      if (!operation.record) continue
      const targetDirectory = path.join(plan.targetOperationsRoot, operation.id)
      const operationDatabase = path.join(targetDirectory, "operation.db")
      await assertNoSymlinkPath(operationDatabase)
      const existing = await store.get(operation.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(operation.record))
        throw new Error("migration destination contains a different operation")

      if (!existing && (await pathExists(operationDatabase))) throw new Error("migration destination has an unreadable operation database")
      if (!existing) {
        const projected = Buffer.from(`${JSON.stringify(operation.record, null, 2)}\n`)
        await preflightWrite(path.join(targetDirectory, "operation.json"), projected, plan.targetOperationsRoot)
      }

      for (const file of operation.files) {
        if (file.disposition !== "public" || file.relativePath === "plans/operation-plan.json") continue
        const source = path.join(plan.sourceOperationsRoot, operation.id, file.relativePath)
        const bytes = await fs.readFile(source)
        if (sha256(bytes) !== file.sha256) throw new Error("migration source changed after planning")
        await preflightWrite(path.join(targetDirectory, file.relativePath), bytes, plan.targetOperationsRoot)
      }

      if (operation.record.plan) {
        const safePlan = { ...operation.record.plan, approvedAt: undefined, approvedBy: undefined }
        const bytes = Buffer.from(`${JSON.stringify(safePlan, null, 2)}\n`)
        await preflightWrite(path.join(targetDirectory, "plans", "operation-plan.json"), bytes, plan.targetOperationsRoot)
      }
    }
  } finally {
    await store.close()
  }
}

async function preflightCredentialDestinations(operations: PlannedOperation[], plan: MigrationPlan) {
  for (const operation of operations) {
    if (!operation.legacyCredentialIndex || operation.legacyCredentialsMalformed) continue
    const operationRoot = path.join(plan.targetOperationsRoot, operation.id)
    const indexFile = path.join(operationRoot, "credentials", "index.json")
    await assertNoSymlinkPath(indexFile)
    const existingCredentials = await listCredentials(operationRoot, operation.id)
    const legacyIndexBytes = await fs.readFile(path.join(plan.sourceOperationsRoot, operation.id, "credentials", "index.json"))
    if (sha256(legacyIndexBytes) !== operation.legacyCredentialIndex.sha256)
      throw new Error("migration source changed after planning")
    const records = decodeLegacyIndex(legacyIndexBytes, operation.id)
    const grouped = groupBy(records, (record) => legacySlug(record.credentialID))
    for (const record of records) {
      const plannedCredential = operation.credentials.find((item) => item.credentialID === record.credentialID)
      if (!plannedCredential) throw new Error("migration plan is invalid")
      const legacySecretPath = path.join(
        plan.sourceStorageRoot,
        "storage",
        "ulm",
        "credential",
        legacySlug(operation.id),
        `${legacySlug(record.credentialID)}.json`,
      )
      const legacySecretBytes = await readSourceStorageFile(
        plan.sourceStorageRoot,
        path.relative(plan.sourceStorageRoot, legacySecretPath),
      )
      if (
        (plannedCredential.legacySecret &&
          (!legacySecretBytes || sha256(legacySecretBytes) !== plannedCredential.legacySecret.sha256)) ||
        (!plannedCredential.legacySecret && legacySecretBytes)
      )
        throw new Error("migration source changed after planning")
      const targetPrivateFile = path.join(plan.targetCredentialsDir, operation.id, `${plannedCredential.handle}.json`)
      await assertNoSymlinkPath(targetPrivateFile)
      const existingPrivateFile = await fs.lstat(targetPrivateFile).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (existingPrivateFile && (!existingPrivateFile.isFile() || existingPrivateFile.isSymbolicLink()))
        throw new Error("migration credential destination is not a regular file")
      const ambiguous = (grouped.get(legacySlug(record.credentialID))?.length ?? 0) > 1
      const privateValue = {
        label: stringValue(record.label),
        type: stringValue(record.type),
        username: stringValue(record.username),
        url: stringValue(record.url),
        target: stringValue(record.target),
        tags: stringArray(record.tags),
        notes: stringValue(record.notes),
        rules: stringValue(record.rules),
        source: record,
        ...(legacySecretBytes ? parseLegacySecret(legacySecretBytes) : {}),
      } satisfies PrivateCredential
      const expectedPrivateBytes = Buffer.from(`${JSON.stringify(privateValue, null, 2)}\n`)
      if (existingPrivateFile && sha256(await fs.readFile(targetPrivateFile)) !== sha256(expectedPrivateBytes))
        throw new Error("migration destination contains different private credential data")
      if (existingCredentials.some((item) => item.credentialID === plannedCredential.handle) && !existingPrivateFile)
        throw new Error("migration destination credential handle has no private record")
      if (ambiguous && plannedCredential.status !== "reauth_required") throw new Error("migration plan is invalid")
    }
  }
}

async function preflightWrite(file: string, bytes: Uint8Array, root: string) {
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
    throw new Error("migration destination path is invalid")
  await assertNoSymlinkPath(file)
  let current = root
  for (const part of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, part)
    const info = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) break
    if (info.isSymbolicLink()) throw new Error("migration destination cannot contain symbolic links")
    if (!info.isDirectory()) throw new Error("migration destination path is not a directory")
  }

  const info = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!info) return
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("migration destination file is not a regular file")
  if (sha256(await fs.readFile(file)) !== sha256(bytes)) throw new Error("migration destination contains different data")
}

async function assertNoSymlinkPath(target: string) {
  const resolved = path.resolve(target)
  const root = path.parse(resolved).root
  let current = root
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const info = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) return
    if (info.isSymbolicLink()) throw new Error("migration does not follow symbolic links")
  }
}

async function pathExists(target: string) {
  try {
    await fs.lstat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function listFiles(root: string, current = root): Promise<Array<{ relativePath: string }>> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, entry.name)
    if (entry.isSymbolicLink()) throw new Error("migration does not follow symbolic links")
    if (entry.isDirectory()) files.push(...(await listFiles(root, absolute)))
    else if (entry.isFile()) files.push({ relativePath: path.relative(root, absolute).split(path.sep).join("/") })
    else throw new Error("migration encountered an unsupported filesystem entry")
  }
  return files
}

function parseLegacyOperation(bytes: Uint8Array, id: string) {
  const value = parseObject(bytes)
  if (!value || value.operationID !== id || typeof value.objective !== "string" || !value.objective.trim()) return undefined
  if (value.status !== undefined && !["planned", "running", "blocked", "paused", "complete", "active"].includes(String(value.status)))
    return undefined
  const time = objectValue(value.time)
  const created = stringValue(time?.created) ?? stringValue(value.createdAt)
  const updated = stringValue(time?.updated) ?? stringValue(value.updatedAt) ?? created
  if (!created || !updated || !Number.isFinite(Date.parse(created)) || !Number.isFinite(Date.parse(updated))) return undefined
  return value
}

function parseLegacyPlan(bytes: Uint8Array, id: string) {
  const value = parseObject(bytes)
  if (!value || value.operationID !== id || !Array.isArray(value.phases)) return undefined
  if (
    value.phases.some(
      (phase) =>
        !phase ||
        typeof phase !== "object" ||
        !["intake", "recon", "mapping", "validation", "reporting", "handoff"].includes(String(phase.stage)) ||
        typeof phase.objective !== "string" ||
        !Array.isArray(phase.successCriteria),
    )
  )
    return undefined
  return value
}

function parseLegacyGoal(bytes: Uint8Array, id: string) {
  const value = parseObject(bytes)
  if (!value || value.operationID !== id || !["active", "complete"].includes(String(value.status))) return undefined
  return value
}

function mapLegacyOperation(input: {
  id: string
  operation: Record<string, unknown>
  plan: Record<string, unknown> | undefined
  goal: Record<string, unknown> | undefined
  files: Array<{ relativePath: string; sha256: string; size: number; disposition: "public" | "quarantined" }>
}): OperationRecord {
  const now = (stringValue(objectValue(input.operation.time)?.updated) ?? stringValue(input.operation.updatedAt)) as string
  const created = (stringValue(objectValue(input.operation.time)?.created) ?? stringValue(input.operation.createdAt)) as string
  const phases = (input.plan?.phases as Array<Record<string, unknown>> | undefined) ?? []
  const oldEvidence = Array.isArray(input.operation.evidence) ? input.operation.evidence : []
  const evidence = oldEvidence.flatMap((item, index) => {
    const value = objectValue(item)
    if (!value) return []
    const id = stringValue(value.id) ?? `legacy-evidence-${index + 1}`
    const sourcePath = stringValue(value.path)
    return [
      {
        id,
        kind: stringValue(value.kind) ?? "legacy_evidence",
        summary: stringValue(value.summary) ?? "Imported legacy evidence reference",
        source: { path: safeEvidencePath(sourcePath, id) },
      },
    ]
  })
  const targetScope = objectValue(input.operation.scope)
  const plan: OperationPlan | undefined = input.plan
    ? {
        version: 1,
        assumptions: [
          ...(stringArray(input.plan.assumptions) ?? []),
          ...(stringArray(input.plan.scopeRules) ?? []).map((rule) => `Legacy scope rule requires operator review: ${rule}`),
          ...phases.flatMap((phase, index) =>
            [
              ...(stringArray(phase.actions) ?? []).map((action) => `Legacy phase ${index + 1} action: ${action}`),
              ...(stringArray(phase.subagents) ?? []).map((agent) => `Legacy phase ${index + 1} subagent policy: ${agent}`),
              ...(stringArray(phase.noSubagents) ?? []).map((rule) => `Legacy phase ${index + 1} no-subagent policy: ${rule}`),
            ],
          ),
          ...(stringArray(input.plan.reportingCloseout) ?? []).map((item) => `Legacy reporting closeout: ${item}`),
        ],
        successCriteria: phases.flatMap((phase) => stringArray(phase.successCriteria) ?? []),
        phases: phases.map((phase, index) => ({
          id: `legacy-phase-${index + 1}`,
          title: stringValue(phase.stage) ?? `Legacy phase ${index + 1}`,
          dependsOn: index === 0 ? [] : [`legacy-phase-${index}`],
          successCriteria: stringArray(phase.successCriteria) ?? [],
          status: "pending",
          restart: "inspect_first",
          required: true,
          expectedArtifacts: [],
        })),
        reporting: { required: true, renderer: "report_render" },
      }
    : undefined
  const targetHours = input.goal?.targetDurationHours
  const artifactRefs = input.files
    .filter((file) => file.disposition === "public")
    .map((file) => ({ path: file.relativePath, sha256: file.sha256, size: file.size }))
  return {
    schemaVersion: 1,
    id: input.id,
    revision: 0,
    createdAt: created,
    updatedAt: now,
    status: "blocked",
    objective: input.operation.objective as string,
    sessionIDs: [],
    scope: {
      targets: stringArray(targetScope?.targets) ?? [],
      mode: targetScope?.mode === "synthetic_lab" ? "synthetic_lab" : "authorized",
      ...(stringValue(targetScope?.authorizationRef) ? { authorizationRef: stringValue(targetScope?.authorizationRef) } : {}),
    },
    ...(plan ? { plan } : {}),
    goal: {
      status: "active",
      startedAt: stringValue(input.goal?.createdAt) ?? created,
      ...(typeof targetHours === "number" && Number.isFinite(targetHours) && targetHours > 0
        ? { targetDurationMs: targetHours * 60 * 60 * 1000 }
        : {}),
      continuation: { enabled: false, maxNoToolTurns: 0, noToolStreak: 0 },
      gates: [
        "plan_approved",
        "required_phases_complete",
        "evidence_normalized",
        "runtime_summary",
        "report_manifest",
        "audit_passed",
        "stage_gate",
      ],
    },
    executions: [],
    artifacts: artifactRefs,
    ...(evidence.length
      ? {
          evidence: {
            operationID: input.id,
            normalizedAt: now,
            normalizerVersion: "legacy-import-v1",
            artifacts: artifactRefs,
            claims: evidence,
            limitations: ["Imported from legacy evidence references; operator validation is required."],
          },
        }
      : {}),
    handoffs: [],
    lastError: {
      code: "legacy_import_review",
      message: "Imported legacy operation is blocked until an operator reviews scope, plan, and execution history.",
      at: now,
    },
  }
}

function isAllowedPublicFile(relativePath: string) {
  return relativePath.startsWith("evidence/") || relativePath.startsWith("findings/") || relativePath.startsWith("deliverables/final/")
}

function safeEvidencePath(value: string | undefined, id: string) {
  if (!value) return `evidence/${id}`
  const normalized = value.replaceAll("\\", "/")
  if (!normalized.startsWith("evidence/") || normalized.split("/").some((part) => !part || part === "." || part === ".."))
    return `evidence/${id}`
  return normalized
}

function credentialValues(records: Array<Record<string, unknown>>) {
  return records.flatMap((record) => Object.values(record).flatMap((value) => (typeof value === "string" && value.length >= 4 ? [value] : [])))
}

function containsCredentialMaterial(value: string, credentials: string[]) {
  return containsCommonCredentialPattern(value) || credentials.some((credential) => value.includes(credential))
}

function containsCommonCredentialPattern(value: string) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value)) return true
  const assignment = /(?:^|[\s"'`{,;])(?:"|')?(?:username|user|password|passwd|pwd|secret|token|access[_-]?token|api[_-]?key|x-api-key|authorization|cookie|private[_-]?key)(?:"|')?\s*[:=]\s*(?:"|')?([^\s"'`,;}]+)/gim
  return [...value.matchAll(assignment)].some((match) => {
    const candidate = match[1]?.trim()
    if (!candidate || candidate.length < 4) return false
    return !/^\[?(?:redacted|masked|hidden|removed|not[_ -]?set|none)\]?$/i.test(candidate)
  })
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function parseObject(bytes: Uint8Array) {
  try {
    return objectValue(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return undefined
  }
}

async function readSourceStorageFile(root: string, relativePath: string) {
  let current = root
  const parts = relativePath.split(path.sep)
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part)
    const info = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) return undefined
    if (info.isSymbolicLink()) throw new Error("migration does not follow symbolic links")
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error("legacy credential path is invalid")
    if (index === parts.length - 1 && !info.isFile()) throw new Error("legacy credential path is invalid")
  }
  return fs.readFile(current)
}

function decodeLegacyIndex(bytes: Uint8Array, id: string): LegacyCredential[] {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as { operationID?: unknown; credentials?: unknown }
  if (
    (value.operationID !== undefined && value.operationID !== id) ||
    !Array.isArray(value.credentials) ||
    value.credentials.some((record) => !record || typeof record !== "object" || typeof record.credentialID !== "string")
  )
    throw new Error("legacy credential index is invalid")
  return value.credentials as LegacyCredential[]
}

function safeDecodeLegacyIndex(bytes: Uint8Array, id: string) {
  try {
    return decodeLegacyIndex(bytes, id)
  } catch {
    return undefined
  }
}

function parseLegacySecret(bytes: Uint8Array): Partial<PrivateCredential> | undefined {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return {
    username: stringValue(record.username),
    password: stringValue(record.password),
    secret: stringValue(record.secret),
  }
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const result = new Map<string, T[]>()
  for (const item of items) result.set(key(item), [...(result.get(key(item)) ?? []), item])
  return result
}

function legacySlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "credential"
}

function handleFor(operation: string, credential: string) {
  return `cred_${sha256(`${operation}\u0000${credential}`)}` as `cred_${string}`
}

function hashID(operation: string, value: string) {
  return sha256(`${operation}\u0000${value}`)
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined
}

function isWithin(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
}

function overlaps(first: string, second: string) {
  return first === second || isWithin(first, second) || isWithin(second, first)
}

async function writeOnce(file: string, bytes: Uint8Array, mode: number, root: string) {
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
    throw new Error("migration destination path is invalid")
  await assertNoSymlinkPath(path.dirname(file))
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await assertNoSymlinkPath(path.dirname(file))
  await fs.chmod(path.dirname(file), 0o700)
  const existing = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("migration destination file is not a regular file")
    if (sha256(await fs.readFile(file)) !== sha256(bytes)) throw new Error("migration destination contains different data")
    return
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, bytes, { mode, flag: "wx" })
  await fs.chmod(temporary, mode)
  try {
    await fs.link(temporary, file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const raced = await fs.lstat(file)
    if (raced.isSymbolicLink() || !raced.isFile() || sha256(await fs.readFile(file)) !== sha256(bytes))
      throw new Error("migration destination contains different data")
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

export * as Migration from "./migration.js"
