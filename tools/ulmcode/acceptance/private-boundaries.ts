import { evidenceRoot } from "./paths"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { storeCredential, listCredentials, reviewCredential, materializeCredential } from "../../../packages/ulm/src/credentials.ts"
import { planMigration, applyMigration } from "../../../packages/ulm/src/migration.ts"

const run = `${evidenceRoot}/private-boundaries-${new Date().toISOString().replace(/[:.]/g, "-")}`
await mkdir(`${run}/private`, { recursive: true, mode: 0o700 })
const operationRoot = `${run}/workspace/.ulmcode/operations/credential-one`
const credentialsDir = `${run}/private/credentials`
const sentinel = { username: crypto.randomUUID(), password: crypto.randomUUID(), notes: crypto.randomUUID() }
const results: { name: string; passed: boolean; detail?: unknown }[] = []
async function check(name: string, passed: boolean, detail?: unknown) { results.push({ name, passed, detail }); console.log(`${name}: ${passed ? "PASS" : "FAIL"}`); await Bun.write(`${run}/results.json`, JSON.stringify({ run, results }, null, 2) + "\n") }
const stored = await storeCredential({ credentialsDir, operationRoot, operationID: "credential-one", value: sentinel })
const material = { credentialsDir, operationRoot, operationID: "credential-one", credentialID: stored.credentialID, target: "http://127.0.0.1:1", executionID: "acceptance-execution" }
await check("unreviewed materialization denied", await materializeCredential(material).then(() => false, () => true))
await reviewCredential({ credentialsDir, operationRoot, operationID: "credential-one", credentialID: stored.credentialID, reviewedBy: "independent-operator", authorizedTargets: [material.target] })
const scoped = await materializeCredential(material)
await check("reviewed target materializes only in memory", Object.values(scoped).includes(sentinel.password) && Object.values(scoped).includes(sentinel.username))
await check("wrong target rejected", await materializeCredential({ ...material, target: "http://127.0.0.1:2" }).then(() => false, () => true))
await check("cross operation rejected", await materializeCredential({ ...material, operationRoot: `${run}/workspace/.ulmcode/operations/credential-two`, operationID: "credential-two" }).then(() => false, () => true))
await check("fresh credential profile rejected", await materializeCredential({ ...material, credentialsDir: `${run}/private/fresh-profile` }).then(() => false, () => true))
const index = await readFile(`${operationRoot}/credentials/index.json`, "utf8")
await check("public index excludes private sentinels", Object.values(sentinel).every((value) => !index.includes(value)))
await check("private credential permissions", ((await stat(`${credentialsDir}/credential-one/${stored.credentialID}.json`)).mode & 0o777) === 0o600)
const raceRoot = `${run}/workspace/.ulmcode/operations/race-operation`
const children = Array.from({ length: 8 }, () => Bun.spawn([process.execPath, new URL("./credentials-race-worker.ts", import.meta.url).pathname, credentialsDir, raceRoot], { stdout: "ignore", stderr: "pipe" }))
const exits = await Promise.all(children.map((child) => child.exited))
const raceIndex = await listCredentials(raceRoot, "race-operation")
await check("concurrent process credential submissions retained", exits.every((code) => code === 0) && raceIndex.length === 8, { processes: children.length, successfulProcesses: exits.filter((code) => code === 0).length, indexedCredentials: raceIndex.length })

const sourceOperationsRoot = `${run}/private/migration-source/operations`
const sourceStorageRoot = `${run}/private/migration-source/storage`
const sourceOperation = `${sourceOperationsRoot}/legacy-one`
await mkdir(`${sourceOperation}/evidence`, { recursive: true })
await mkdir(`${sourceOperationsRoot}/malformed-one`, { recursive: true })
await mkdir(sourceStorageRoot, { recursive: true })
const now = new Date().toISOString()
await writeFile(`${sourceOperation}/operation.json`, JSON.stringify({ operationID: "legacy-one", objective: "Synthetic migration source", status: "running", scope: { targets: ["http://127.0.0.1:1"], mode: "synthetic_lab" }, evidence: [{ id: "legacy-proof", path: "evidence/proof.txt", summary: "Synthetic portable proof" }], time: { created: now, updated: now } }))
await writeFile(`${sourceOperation}/evidence/proof.txt`, "Independent synthetic observation\n")
await writeFile(`${sourceOperation}/unknown.bin`, crypto.randomUUID())
await writeFile(`${sourceOperationsRoot}/malformed-one/operation.json`, "{broken")
const targetWorkspaceRoot = `${run}/migration-target/workspace`
const input = { sourceOperationsRoot, sourceStorageRoot, targetWorkspaceRoot, targetOperationsRoot: `${targetWorkspaceRoot}/.ulmcode/operations`, targetCredentialsDir: `${run}/private/migration-target-credentials` }
const before = await hashes(`${run}/private/migration-source`)
const plan = await planMigration(input)
await check("migration dry-run read-only", JSON.stringify(before) === JSON.stringify(await hashes(`${run}/private/migration-source`)))
await check("migration malformed quarantine visible", plan.importableOperationCount === 1 && plan.quarantinedOperationCount === 1, { importable: plan.importableOperationCount, quarantined: plan.quarantinedOperationCount })
const first = await applyMigration(plan)
const second = await applyMigration(plan)
await check("migration source preserved after apply retry", JSON.stringify(before) === JSON.stringify(await hashes(`${run}/private/migration-source`)))
await check("migration retry idempotent", first.planID === second.planID && second.importedOperations === 1)
await check("unknown migration source not public", !await Bun.file(`${input.targetOperationsRoot}/legacy-one/unknown.bin`).exists())
await writeFile(`${sourceOperation}/evidence/proof.txt`, "Modified after planning\n")
await check("changed migration source rejects stale plan", await applyMigration(plan).then(() => false, () => true))
async function hashes(root: string): Promise<{ path: string; hash: string }[]> { return (await Promise.all((await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => entry.isDirectory() ? (await hashes(`${root}/${entry.name}`)).map((item) => ({ path: `${entry.name}/${item.path}`, hash: item.hash })) : [{ path: entry.name, hash: createHash("sha256").update(await readFile(`${root}/${entry.name}`)).digest("hex") }]))).flat() }
if (results.some((item) => !item.passed)) process.exitCode = 1
