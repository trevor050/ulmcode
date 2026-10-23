#!/usr/bin/env bun
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { applyMigration, planMigration, type MigrationPlan } from "../../packages/ulm/src/migration.js"

const parsed = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    "source-operations": { type: "string" },
    "source-storage": { type: "string" },
    "target-workspace": { type: "string" },
    "target-credentials": { type: "string" },
    "plan-file": { type: "string" },
    "receipt-file": { type: "string" },
    confirm: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
})

function required(value: string | undefined, option: string) {
  if (!value?.trim()) throw new Error(`missing --${option}`)
  return value
}

function usage() {
  console.log(`ULMCode portable operation migration

Usage:
  bun tools/ulmcode/migrate.ts plan \\
    --source-operations <legacy-operations-dir> \\
    --source-storage <legacy-storage-root> \\
    --target-workspace <new-workspace> \\
    --target-credentials <private-vault-dir> \\
    --plan-file <private-plan.json>

  bun tools/ulmcode/migrate.ts apply \\
    --plan-file <private-plan.json> \\
    --receipt-file <private-receipt.json> \\
    --confirm

Planning is read-only. Apply requires a plan produced by this command and an explicit --confirm.
Source and destination roots are always supplied explicitly; this command never discovers a home profile.`)
}

if (parsed.values.help || !parsed.positionals[0]) {
  usage()
  process.exit(0)
}

const command = parsed.positionals[0]
if (command === "plan") {
  const targetWorkspaceRoot = path.resolve(required(parsed.values["target-workspace"], "target-workspace"))
  const input = {
    sourceOperationsRoot: path.resolve(required(parsed.values["source-operations"], "source-operations")),
    sourceStorageRoot: path.resolve(required(parsed.values["source-storage"], "source-storage")),
    targetWorkspaceRoot,
    targetOperationsRoot: path.join(targetWorkspaceRoot, ".ulmcode", "operations"),
    targetCredentialsDir: path.resolve(required(parsed.values["target-credentials"], "target-credentials")),
  }
  const output = path.resolve(required(parsed.values["plan-file"], "plan-file"))
  assertPrivateOutputOutsideRoots(output, [input.sourceOperationsRoot, input.sourceStorageRoot, input.targetWorkspaceRoot, input.targetCredentialsDir])
  const plan = await planMigration(input)
  await writePrivateJson(output, plan)
  console.log(
    JSON.stringify({
      status: "planned",
      planID: plan.planID,
      operations: plan.operationCount,
      importable: plan.importableOperationCount,
      quarantined: plan.quarantinedOperationCount,
      files: plan.fileCount,
      credentials: plan.credentialCount,
      reauthenticationRequired: plan.reauthenticationCount,
    }),
  )
  process.exit(0)
}

if (command === "apply") {
  if (!parsed.values.confirm) throw new Error("apply requires explicit --confirm")
  const planFile = path.resolve(required(parsed.values["plan-file"], "plan-file"))
  const receiptFile = path.resolve(required(parsed.values["receipt-file"], "receipt-file"))
  const plan = await readPrivatePlan(planFile)
  const privateRoots = [plan.sourceOperationsRoot, plan.sourceStorageRoot, plan.targetWorkspaceRoot, plan.targetCredentialsDir]
  assertPrivateOutputOutsideRoots(planFile, privateRoots)
  assertPrivateOutputOutsideRoots(receiptFile, privateRoots)
  if (receiptFile === planFile) throw new Error("plan and receipt must use separate files")
  await ensurePrivateDirectory(path.dirname(receiptFile))
  await assertPrivateFile(receiptFile)
  const result = await applyMigration(plan)
  await writePrivateJson(receiptFile, { schemaVersion: 1, status: "complete", ...result })
  console.log(
    JSON.stringify({
      status: "complete",
      planID: result.planID,
      importedOperations: result.importedOperations,
      quarantinedOperations: result.quarantinedOperations,
      copiedFiles: result.copiedFiles,
      credentials: result.copiedCredentials,
      reauthenticationRequired: result.reauthenticationRequired,
    }),
  )
  process.exit(0)
}

throw new Error(`unknown migration command: ${command}`)

function assertPrivateOutputOutsideRoots(output: string, roots: string[]) {
  if (roots.some((root) => output === root || output.startsWith(root + path.sep)))
    throw new Error("private plan and receipt files must be outside source and operation destination roots")
}

async function writePrivateJson(file: string, value: unknown) {
  const directory = path.dirname(file)
  await ensurePrivateDirectory(directory)
  const contents = `${JSON.stringify(value, null, 2)}\n`
  await assertPrivateFile(file, contents)
  if (await Bun.file(file).exists()) return
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)
  await fs.writeFile(temporary, contents, { mode: 0o600, flag: "wx" })
  await fs.chmod(temporary, 0o600)
  try {
    await fs.link(temporary, file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const existing = await fs.lstat(file)
    if (existing.isSymbolicLink() || !existing.isFile() || (existing.mode & 0o077) !== 0)
      throw new Error("existing plan or receipt must be a private regular file")
    if ((await fs.readFile(file, "utf8")) !== contents) throw new Error("private plan or receipt already exists with different contents")
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

async function readPrivatePlan(file: string): Promise<MigrationPlan> {
  await ensurePrivateDirectory(path.dirname(file))
  await assertPrivateFile(file)
  return JSON.parse(await fs.readFile(file, "utf8")) as MigrationPlan
}

async function ensurePrivateDirectory(directory: string) {
  const resolved = path.resolve(directory)
  const root = path.parse(resolved).root
  let current = root
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    let info = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) {
      await fs.mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error
      })
      info = await fs.lstat(current)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("plan and receipt paths cannot contain symbolic links")
  }
  const info = await fs.lstat(resolved)
  if ((info.mode & 0o077) !== 0) throw new Error("plan and receipt directory must be private (mode 0700 or stricter)")
}

async function assertPrivateFile(file: string, expected?: string) {
  const info = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!info) return
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
    throw new Error("existing plan or receipt must be a private regular file")
  if (expected !== undefined && (await fs.readFile(file, "utf8")) !== expected)
    throw new Error("private plan or receipt already exists with different contents")
}
