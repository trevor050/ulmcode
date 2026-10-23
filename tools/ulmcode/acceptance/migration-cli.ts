import { createHash } from "node:crypto"
import { mkdir, readFile, stat, symlink } from "node:fs/promises"
import { listCredentials, materializeCredential } from "../../../packages/ulm/src/credentials"
import { checkoutRoot, evidenceRoot } from "./paths"

const run = `${evidenceRoot}/migration-cli-${new Date().toISOString().replace(/[:.]/g, "-")}`
const sourceOperations = `${run}/private/source/operations`
const sourceStorage = `${run}/private/source/storage`
const target = `${run}/target/workspace`
const credentials = `${run}/private/target-credentials`
const output = `${run}/private/output`
const sourceOperation = `${sourceOperations}/legacy-cli`
const operationRoot = `${target}/.ulmcode/operations/legacy-cli`
const planFile = `${output}/plan.json`
const receiptFile = `${output}/receipt.json`
const raw = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
const results: { name: string; passed: boolean; detail?: unknown }[] = []
const commands: { args: string[]; exit: number; stdout: string; stderr: string }[] = []
for (const dir of [`${sourceOperation}/credentials`, `${sourceStorage}/storage/ulm/credential/legacy-cli`, output])
  await mkdir(dir, { recursive: true, mode: 0o700 })
const sources = [
  {
    path: `${sourceOperation}/operation.json`,
    data: {
      operationID: "legacy-cli",
      objective: "Independent synthetic migration CLI",
      status: "running",
      scope: { targets: ["http://127.0.0.1:9"], mode: "synthetic_lab" },
      time: { created: new Date().toISOString(), updated: new Date().toISOString() },
    },
  },
  {
    path: `${sourceOperation}/credentials/index.json`,
    data: {
      operationID: "legacy-cli",
      credentials: [{ credentialID: "fixture-handle", username: raw[0], notes: raw[2] }],
    },
  },
  {
    path: `${sourceStorage}/storage/ulm/credential/legacy-cli/fixture-handle.json`,
    data: {
      operationID: "legacy-cli",
      credentialID: "fixture-handle",
      username: raw[0],
      password: raw[1],
      notes: raw[2],
    },
  },
]
for (const source of sources) await Bun.write(source.path, JSON.stringify(source.data))
const before = await Promise.all(sources.map(async (source) => digest(await readFile(source.path))))
function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}
const scrub = (value: string) =>
  raw
    .reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value)
    .replace(/cred_[a-zA-Z0-9_-]+/g, "[REDACTED_HANDLE]")
async function invoke(args: string[]) {
  const child = Bun.spawn([process.execPath, `${checkoutRoot}/tools/ulmcode/migrate.ts`, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15000,
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  commands.push({ args, exit, stdout: scrub(stdout), stderr: scrub(stderr) })
  await Bun.write(`${run}/commands.json`, JSON.stringify(commands, null, 2))
  return { exit, stdout, stderr }
}
async function check(name: string, passed: boolean, detail?: unknown) {
  results.push({ name, passed, detail })
  await Bun.write(`${run}/results.json`, JSON.stringify({ run, results }, null, 2) + "\n")
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`)
  if (!passed) throw new Error(name)
}
function planning(file: string) {
  return [
    "plan",
    "--source-operations",
    sourceOperations,
    "--source-storage",
    sourceStorage,
    "--target-workspace",
    target,
    "--target-credentials",
    credentials,
    "--plan-file",
    file,
  ]
}
const planned = await invoke(planning(planFile))
await check(
  "actual migration CLI plans without importing state",
  planned.exit === 0 && !(await Bun.file(`${operationRoot}/operation.db`).exists()),
)
const planText = await Bun.file(planFile).text()
await check(
  "plan and output modes are private and plan contains no raw credential fields",
  ((await stat(planFile)).mode & 0o777) === 0o600 &&
    ((await stat(output)).mode & 0o777) === 0o700 &&
    raw.every((value) => !planText.includes(value)),
)
const applyArgs = ["apply", "--plan-file", planFile, "--receipt-file", receiptFile]
await check(
  "missing confirm cannot import operations",
  (await invoke(applyArgs)).exit !== 0 && !(await Bun.file(`${operationRoot}/operation.db`).exists()),
)
await check(
  "confirmed CLI apply and exact retry succeed",
  (await invoke([...applyArgs, "--confirm"])).exit === 0 && (await invoke([...applyArgs, "--confirm"])).exit === 0,
)
const receipt = await Bun.file(receiptFile).text()
const metadata = await listCredentials(operationRoot, "legacy-cli")
await check(
  "migrated credential requires fresh review and cannot materialize",
  metadata.length === 1 &&
    metadata[0]?.status === "needs_review" &&
    (await materializeCredential({
      credentialsDir: credentials,
      operationRoot,
      operationID: "legacy-cli",
      credentialID: metadata[0].credentialID,
      target: "http://127.0.0.1:9",
      executionID: "acceptance",
    }).then(
      () => false,
      () => true,
    )),
)
const publicIndex = await Bun.file(`${operationRoot}/credentials/index.json`).text()
await check(
  "receipt stdout stderr and public credential index are redacted",
  ((await stat(receiptFile)).mode & 0o777) === 0o600 &&
    raw.every(
      (value) =>
        ![receipt, publicIndex, ...commands.flatMap((command) => [command.stdout, command.stderr])].some((text) =>
          text.includes(value),
        ),
    ),
)
await check(
  "planning and apply preserve source bytes",
  (await Promise.all(sources.map(async (source) => digest(await readFile(source.path))))).every(
    (hash, index) => hash === before[index],
  ),
)
await check(
  "lexical source-root output is rejected",
  (await invoke(planning(`${sourceOperations}/bad-plan.json`))).exit !== 0,
)
await mkdir(`${sourceOperations}/private-metadata`, { mode: 0o700 })
await symlink(`${sourceOperations}/private-metadata`, `${output}/source-alias`)
const escaped = await invoke(planning(`${output}/source-alias/escaped-plan.json`))
await check(
  "symlinked plan output cannot mutate a source root",
  escaped.exit !== 0 && !(await Bun.file(`${sourceOperations}/private-metadata/escaped-plan.json`).exists()),
  {
    exit: escaped.exit,
    sourceFileCreated: await Bun.file(`${sourceOperations}/private-metadata/escaped-plan.json`).exists(),
  },
)
const ancestorEscape = await invoke(planning(`${output}/source-alias/nested/escaped-plan.json`))
await check(
  "symlinked output ancestor cannot mutate a source root",
  ancestorEscape.exit !== 0 &&
    !(await Bun.file(`${sourceOperations}/private-metadata/nested/escaped-plan.json`).exists()),
  {
    exit: ancestorEscape.exit,
    sourceFileCreated: await Bun.file(`${sourceOperations}/private-metadata/nested/escaped-plan.json`).exists(),
  },
)
