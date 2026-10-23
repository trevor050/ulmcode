import { evidenceRoot } from "./paths"
import { cp, mkdir, readFile, writeFile, symlink, unlink } from "node:fs/promises"
import { createHash } from "node:crypto"
import { lintReport } from "../../../packages/ulm/src/report.ts"
import type { OperationRecord } from "../../../packages/ulm/src/operation.ts"

const source = process.argv[2]
if (!source) throw new Error("Provide a completed synthetic operation directory")
const run = `${evidenceRoot}/integrity-${new Date().toISOString().replace(/[:.]/g, "-")}`
await mkdir(run, { recursive: true })
const operation = await Bun.file(`${source}/operation.json`).json() as OperationRecord
const results: { name: string; passed: boolean; blockers: string[] }[] = []
const baseline = await lintReport({ operation, operationDirectory: source })
results.push({ name: "original source-driven package passes", passed: baseline.ok, blockers: baseline.blockers })
const mutations: { name: string; run: (directory: string, record: OperationRecord) => Promise<void> | void }[] = [
  { name: "wrong manifest operation identity", async run(directory) { const file = `${directory}/deliverables/final/manifest.json`; const row = await Bun.file(file).json(); row.operationID = "wrong-operation"; await Bun.write(file, JSON.stringify(row)) } },
  { name: "tampered HTML", async run(directory) { await writeFile(`${directory}/deliverables/final/report.html`, "tampered") } },
  { name: "extra final file", async run(directory) { await writeFile(`${directory}/deliverables/final/extra.txt`, "unexpected") } },
  { name: "stale audit revision", run(_directory, record) { if (record.audit) record.audit.recordRevision-- } },
  { name: "changed operation objective", run(_directory, record) { record.objective += " changed after rendering" } },
  { name: "changed raw evidence", async run(directory, record) { const artifact = record.evidence?.artifacts.find((item) => item.path.startsWith("lab/") && item.path.endsWith(".json")); if (!artifact) throw new Error("no raw evidence"); await writeFile(`${directory}/${artifact.path}`, "{\"tampered\":true}") } },
  { name: "symlink PDF escape", async run(directory) { await unlink(`${directory}/deliverables/final/report.pdf`); await symlink(`${source}/deliverables/final/report.pdf`, `${directory}/deliverables/final/report.pdf`) } },
  { name: "runtime summary wrong identity with reconciled file hashes", async run(directory, record) { const file = `${directory}/deliverables/final/runtime-summary.json`; const row = await Bun.file(file).json(); row.operationID = "other-operation"; await writeFile(file, JSON.stringify(row)); await rehash(directory, record, "deliverables/final/runtime-summary.json") } },
  { name: "invalid PDF with reconciled file hashes", async run(directory, record) { await writeFile(`${directory}/deliverables/final/report.pdf`, "%PDF-1.4\n%%EOF"); await rehash(directory, record, "deliverables/final/report.pdf") } },
  { name: "manifest traversal with reconciled manifest reference", async run(directory, record) { const file = `${directory}/deliverables/final/manifest.json`; const row = await Bun.file(file).json(); row.files[0].path = "../../escape.html"; await writeFile(file, JSON.stringify(row)); await rehashManifest(directory, record) } },
]
for (const mutation of mutations) {
  const directory = `${run}/${mutation.name.replace(/\W+/g, "-")}`
  await cp(source, directory, { recursive: true })
  const record = structuredClone(operation)
  await mutation.run(directory, record)
  const lint = await lintReport({ operation: record, operationDirectory: directory })
  results.push({ name: mutation.name, passed: !lint.ok, blockers: lint.blockers })
  console.log(`${mutation.name}: ${lint.ok ? "FAIL accepted corruption" : "PASS rejected"}`)
}
await Bun.write(`${run}/results.json`, JSON.stringify({ source, results }, null, 2) + "\n")
if (results.some((item) => !item.passed)) process.exitCode = 1

async function rehash(directory: string, record: OperationRecord, relative: string) {
  const hash = createHash("sha256").update(await readFile(`${directory}/${relative}`)).digest("hex")
  const ref = record.artifacts.find((item) => item.path === relative)
  if (ref) ref.sha256 = hash
  const manifestFile = `${directory}/deliverables/final/manifest.json`
  const manifest = await Bun.file(manifestFile).json()
  const entry = manifest.files.find((item: { path: string }) => item.path === relative)
  if (entry) entry.sha256 = hash
  await writeFile(manifestFile, JSON.stringify(manifest))
  await rehashManifest(directory, record)
}
async function rehashManifest(directory: string, record: OperationRecord) {
  const ref = record.artifacts.find((item) => item.path === "deliverables/final/manifest.json")
  if (ref) ref.sha256 = createHash("sha256").update(await readFile(`${directory}/deliverables/final/manifest.json`)).digest("hex")
}
