import { createHash } from "node:crypto"
import { mkdir, readdir, readFile } from "node:fs/promises"
import { planMigration, applyMigration } from "../../../packages/ulm/src/migration"
import { OperationStore } from "../../../packages/ulm/src/store"
import { evidenceRoot } from "./paths"

if (process.argv[2] === "--apply") {
  const result = await applyMigration(await Bun.file(process.argv[3]!).json())
  await Bun.write(process.argv[4]!, JSON.stringify(result))
  process.exit(0)
}
const run = `${evidenceRoot}/migration-interrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`
const sourceOperationsRoot = `${run}/private/source/operations`
const sourceStorageRoot = `${run}/private/source/storage`
const sourceOperation = `${sourceOperationsRoot}/legacy-interrupted`
const targetWorkspaceRoot = `${run}/target/workspace`
const targetCredentialsDir = `${run}/private/target-credentials`
const archive = `${targetCredentialsDir}/legacy-interrupted/quarantine/legacy-operation`
const results: { name: string; passed: boolean; detail?: unknown }[] = []
await mkdir(`${sourceOperation}/evidence`, { recursive: true, mode: 0o700 })
await mkdir(sourceStorageRoot, { recursive: true, mode: 0o700 })
const now = new Date().toISOString()
await Bun.write(
  `${sourceOperation}/operation.json`,
  JSON.stringify({
    operationID: "legacy-interrupted",
    objective: "Synthetic interrupted migration",
    status: "running",
    scope: { targets: ["http://127.0.0.1:9"], mode: "synthetic_lab" },
    time: { created: now, updated: now },
  }),
)
for (let index = 0; index < 200; index++)
  await Bun.write(
    `${sourceOperation}/evidence/proof-${String(index).padStart(3, "0")}.txt`,
    `Synthetic local observation ${index}\n` + "Measured fixture evidence.\n".repeat(1200),
  )
const before = await hashes(sourceOperation)
const plan = await planMigration({
  sourceOperationsRoot,
  sourceStorageRoot,
  targetWorkspaceRoot,
  targetOperationsRoot: `${targetWorkspaceRoot}/.ulmcode/operations`,
  targetCredentialsDir,
})
await Bun.write(`${run}/private/plan.json`, JSON.stringify(plan))
async function check(name: string, passed: boolean, detail?: unknown) {
  results.push({ name, passed, detail })
  await Bun.write(`${run}/results.json`, JSON.stringify({ run, results }, null, 2) + "\n")
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`)
  if (!passed) throw new Error(name)
}
function apply(output: string) {
  return Bun.spawn([process.execPath, import.meta.path, "--apply", `${run}/private/plan.json`, output], {
    stdout: "ignore",
    stderr: Bun.file(`${output}.stderr`),
    timeout: 15000,
  })
}
const child = apply(`${run}/first.json`)
let copiedAtKill = 0
try {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline && child.exitCode === null) {
    copiedAtKill = (await readdir(archive).catch(() => [])).filter((file) => file.endsWith(".bin")).length
    if (copiedAtKill >= 2 && copiedAtKill < 201) break
    await Bun.sleep(2)
  }
  await check(
    "migration SIGKILL occurs after real partial destination writes",
    child.exitCode === null && copiedAtKill >= 2 && copiedAtKill < 201,
    { copiedAtKill },
  )
  child.kill("SIGKILL")
  await child.exited
  await check(
    "source hashes survive interrupted migration",
    JSON.stringify(before) === JSON.stringify(await hashes(sourceOperation)),
  )
  const resumed = apply(`${run}/resumed.json`)
  await check("new migration process retries the original plan successfully", (await resumed.exited) === 0)
  const repeated = apply(`${run}/repeated.json`)
  await check(
    "post-interruption retry remains idempotent",
    (await repeated.exited) === 0 &&
      (await Bun.file(`${run}/resumed.json`).json()).planID === (await Bun.file(`${run}/repeated.json`).json()).planID,
  )
  const store = new OperationStore({ workspaceRoot: targetWorkspaceRoot })
  try {
    const operation = await store.get("legacy-interrupted")
    const copied = await hashes(`${targetWorkspaceRoot}/.ulmcode/operations/legacy-interrupted/evidence`)
    await check(
      "recovered operation and every source evidence file are intact",
      operation?.id === "legacy-interrupted" &&
        copied.length === 200 &&
        copied.every(
          (item, index) => item.hash === before.filter((entry) => entry.file.startsWith("evidence/"))[index]?.hash,
        ),
    )
  } finally {
    await store.close()
  }
  await check(
    "source hashes remain unchanged after recovery and retry",
    JSON.stringify(before) === JSON.stringify(await hashes(sourceOperation)),
  )
} finally {
  if (child.exitCode === null) {
    child.kill("SIGKILL")
    await child.exited
  }
}
async function hashes(root: string) {
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true }))).sort()
  return Promise.all(
    files.map(async (file) => ({
      file,
      hash: createHash("sha256")
        .update(await readFile(`${root}/${file}`))
        .digest("hex"),
    })),
  )
}
