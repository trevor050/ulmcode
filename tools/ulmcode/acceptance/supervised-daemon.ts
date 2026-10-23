import { mkdir, readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { storeCredential, reviewCredential } from "../../../packages/ulm/src/credentials"
import { lintReport } from "../../../packages/ulm/src/report"
import { checkoutRoot, evidenceRoot, chromiumPath } from "./paths"

const run = `${evidenceRoot}/supervised-${new Date().toISOString().replace(/[:.]/g, "-")}`
const workspace = `${run}/workspace`
const profile = `${run}/private/profile`
await mkdir(`${workspace}/.ulmcode/operations`, { recursive: true })
await mkdir(`${run}/private`, { recursive: true, mode: 0o700 })
const results: { name: string; passed: boolean; detail?: unknown }[] = []
const commands: { argv: string[]; exit: number; stdout: string; stderr: string }[] = []
const children = new Set<number>()
const rawValues = [crypto.randomUUID(), crypto.randomUUID()]
const scrub = (text: string) => rawValues.reduce((result, value) => result.replaceAll(value, "[REDACTED]"), text).replace(/cred_[a-zA-Z0-9_-]+/g, "[REDACTED_CREDENTIAL_HANDLE]")
async function check(name: string, passed: boolean, detail?: unknown) { results.push({ name, passed, detail }); console.log(`${name}: ${passed ? "PASS" : "FAIL"}`); await Bun.write(`${run}/results.json`, JSON.stringify({ run, results }, null, 2) + "\n"); if (!passed) throw new Error(name) }
const lab = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { return new URL(request.url).pathname === "/api/lab" ? Response.json({ lab: "Independent supervised local target", observations: [{ kind: "informational", subject: "local fixture", summary: "Actual subprocess collected this scoped HTTP response" }] }) : Response.json({ status: "ok" }) } })
const target = `http://127.0.0.1:${lab.port}`
const fixture = new URL("./command-fixture.ts", import.meta.url).pathname
const catalogFile = `${run}/catalog.json`
const catalogArgument = path.relative(checkoutRoot, catalogFile)
await Bun.write(catalogFile, JSON.stringify({ schemaVersion: 1, profiles: ["observe", "failure", "secrets", "orphan", "long"].map((mode) => ({ profileID: `acceptance-${mode}`, safety: "non_destructive", scopes: ["synthetic_lab"], executable: process.execPath, args: [fixture, mode, "{{marker}}", "{{target}}", "{{duration}}"], variables: { marker: "literal", target: "target", duration: "literal" }, targetPolicy: "loopback", timeoutMs: mode === "orphan" ? 400 : 10_000, maxOutputBytes: 20_000, restart: "safe" })) }, null, 2))
async function cli(tail: string[]) {
  const argv = [process.execPath, `${checkoutRoot}/packages/ulm/src/cli.ts`, ...tail, "--workspace", workspace, "--profile-root", profile, "--command-catalog", catalogArgument, "--chromium", chromiumPath]
  const child = Bun.spawn(argv, { cwd: checkoutRoot, stdout: "pipe", stderr: "pipe", timeout: 40_000, env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` } })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  commands.push({ argv, exit, stdout: scrub(stdout), stderr: scrub(stderr) })
  await Bun.write(`${run}/commands.json`, JSON.stringify(commands, null, 2) + "\n")
  return { exit, body: stdout ? JSON.parse(stdout) : undefined }
}
async function create(id: string, mode: string, duration = 100, credentialHandles?: string[]) {
  const input = { id, sessionID: `session-${id}`, objective: "Independently verify trusted local supervised commands and durable closeout", scope: { targets: [target], mode: "synthetic_lab" }, plan: { version: 1, assumptions: ["Only this local synthetic command and loopback service are in scope"], successCriteria: ["Record actual local command output and real audited deliverables"], phases: [{ id: "command", title: "Run independently defined local command", dependsOn: [], successCriteria: ["Local command returns durable proof"], restart: "safe", expectedArtifacts: [], command: { profileID: `acceptance-${mode}`, variables: { target, marker: `${run}/${id}.marker`, duration: String(duration) }, credentialHandles } }], reporting: { required: true } } }
  const inputFile = `${run}/private/${id}.input.json`
  await Bun.write(inputFile, JSON.stringify(input))
  const created = await cli(["create", "--input", inputFile])
  const approved = await cli(["approve", id, "--operator", "independent-operator"])
  await check(`${id} approved through separate CLI processes`, created.exit === 0 && approved.exit === 0)
}
async function settle(id: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { const response = await cli(["run", id]); const operation = response.body?.decision?.operation; if (operation?.executions[0] && !["running", "intent"].includes(operation.executions[0].status)) return operation; await Bun.sleep(80) }
  throw new Error(`Execution did not settle: ${id}`)
}
try {
  if (process.env.ACCEPTANCE_SUPERVISED_RESTART_ONLY !== "1") {
  await create("concurrent-command", "observe")
  await Promise.all([cli(["run", "concurrent-command"]), cli(["run", "concurrent-command"])])
  const concurrent = await settle("concurrent-command")
  await check("two CLI launch contenders dispatch once", concurrent.executions.length === 1 && concurrent.executions[0].status === "succeeded" && await Bun.file(`${run}/concurrent-command.marker`).text() === "x")
  await create("failed-command", "failure")
  const failed = await settle("failed-command")
  const failureFiles = failed.executions[0].artifactRefs.map((item: { path: string }) => item.path)
  const emptyError = failureFiles.find((item: string) => item.endsWith(".stderr.txt"))
  await check("nonzero exit preserves partial output and empty stderr", failed.executions[0].status === "failed" && failureFiles.some((item: string) => item.endsWith(".stdout.txt")) && Boolean(emptyError) && (await Bun.file(`${workspace}/.ulmcode/operations/failed-command/${emptyError}`).text()).trim() === "")
  const secretRoot = `${workspace}/.ulmcode/operations/redacted-command`
  const credentialsDir = `${profile}/private/credentials`
  const credential = await storeCredential({ credentialsDir, operationRoot: secretRoot, operationID: "redacted-command", value: { username: rawValues[0], password: rawValues[1] } })
  await reviewCredential({ credentialsDir, operationRoot: secretRoot, operationID: "redacted-command", credentialID: credential.credentialID, reviewedBy: "independent-operator", authorizedTargets: [target] })
  await create("redacted-command", "secrets", 100, [credential.credentialID])
  const redacted = await settle("redacted-command")
  const output = (await Promise.all(redacted.executions[0].artifactRefs.map((ref: { path: string }) => Bun.file(`${secretRoot}/${ref.path}`).text()))).join("\n")
  await check("credential values split across output chunks are redacted", redacted.executions[0].status === "succeeded" && output.includes("[REDACTED]") && rawValues.every((value) => !output.includes(value)))
  const publicFiles = await walk(`${workspace}/.ulmcode`)
  const leaked = (await Promise.all(publicFiles.map(async (file) => { const bytes = await readFile(file); return rawValues.some((value) => bytes.includes(Buffer.from(value))) ? file : undefined }))).filter(Boolean)
  await check("submitted raw values absent from operation and supervision files", leaked.length === 0, { checkedFiles: publicFiles.length, leakingFiles: leaked })
  await create("pipe-orphan", "orphan")
  const started = Date.now()
  const orphan = await settle("pipe-orphan", 7000)
  await check("hard timeout drains orphan-held pipes", orphan.executions[0].status === "failed" && Date.now() - started < 7000 && /time limit/.test(orphan.executions[0].errorSummary ?? ""), { elapsedMs: Date.now() - started })
  await create("daemon-closeout", "observe")
  const detached = await cli(["daemon", "daemon-closeout", "--detach"])
  if (detached.body?.pid) children.add(detached.body.pid)
  await check("detached CLI proves its persisted heartbeat PID", detached.exit === 0 && Boolean(detached.body?.pid))
  let heartbeat: { status?: string; pid?: number } = {}
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) { heartbeat = await Bun.file(`${workspace}/.ulmcode/operations/daemon-closeout/runtime/scheduler.json`).json(); if (heartbeat.status !== "running") break; await Bun.sleep(100) }
  const final = (await cli(["status", "daemon-closeout"])).body.operation
  const lint = await lintReport({ operation: final, operationDirectory: `${workspace}/.ulmcode/operations/daemon-closeout` })
  await check("detached daemon autonomously collects normalizes renders and audits", heartbeat.status === "complete" && final.goal.status === "complete" && lint.ok, { heartbeatStatus: heartbeat.status, goalStatus: final.goal.status, reportBlockers: lint.blockers })
  }
  await create("daemon-restart", "long", 2000)
  const firstDaemon = await cli(["daemon", "daemon-restart", "--detach"])
  await check("restart fixture daemon establishes heartbeat", firstDaemon.exit === 0 && Boolean(firstDaemon.body?.pid))
  const firstPID = firstDaemon.body.pid as number
  children.add(firstPID)
  for (let attempt = 0; attempt < 100 && !await Bun.file(`${run}/daemon-restart.marker`).exists(); attempt++) await Bun.sleep(20)
  const competing = await cli(["daemon", "daemon-restart"])
  await check("second scheduler process cannot steal active operation lock", competing.exit !== 0 && await Bun.file(`${run}/daemon-restart.marker`).text() === "x")
  process.kill(firstPID, "SIGTERM")
  const stoppedState = await waitScheduler("daemon-restart", (state) => state.status === "interrupted")
  await check("scheduler SIGTERM persists interrupted origin", stoppedState.interruptedBySignal === true)
  const resumed = await cli(["daemon", "daemon-restart", "--detach", "--resume"])
  if (resumed.body?.pid) children.add(resumed.body.pid)
  await check("explicit resume restarts signal-interrupted scheduler", resumed.exit === 0 && resumed.body?.pid !== firstPID)
  const resumedState = await waitScheduler("daemon-restart", (state) => state.status !== "running")
  const resumedOperation = (await cli(["status", "daemon-restart"])).body.operation
  await check("resumed scheduler records retry and genuinely completes report", resumedState.status === "complete" && resumedOperation.goal.status === "complete" && resumedOperation.executions[0].attempt === 2 && await Bun.file(`${run}/daemon-restart.marker`).text() === "xx", { status: resumedState.status, attempt: resumedOperation.executions[0].attempt })
  await create("operator-stop", "long", 2000)
  await cli(["run", "operator-stop"])
  for (let attempt = 0; attempt < 100 && !await Bun.file(`${run}/operator-stop.marker`).exists(); attempt++) await Bun.sleep(20)
  await cli(["interrupt", "operator-stop", "--reason", "Independent explicit operator stop"])
  const bypass = await cli(["daemon", "operator-stop", "--resume"])
  const operatorStopped = (await cli(["status", "operator-stop"])).body.operation
  await check("daemon resume cannot bypass an operator stop", bypass.exit === 2 && operatorStopped.status === "interrupted" && await Bun.file(`${run}/operator-stop.marker`).text() === "x")
} finally { lab.stop(true); for (const pid of children) { const argv = await Bun.file(`/proc/${pid}/cmdline`).text().catch(() => ""); if (argv.includes(workspace) && argv.includes("daemon")) { try { process.kill(pid, "SIGTERM") } catch {} } } }
async function walk(root: string): Promise<string[]> { return (await Promise.all((await readdir(root, { withFileTypes: true })).map((entry) => entry.isDirectory() ? walk(`${root}/${entry.name}`) : [`${root}/${entry.name}`]))).flat() }
async function waitScheduler(id: string, predicate: (state: { status: string; interruptedBySignal?: boolean }) => boolean) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) { const state = await Bun.file(`${workspace}/.ulmcode/operations/${id}/runtime/scheduler.json`).json(); if (predicate(state)) return state; await Bun.sleep(80) }
  throw new Error(`Scheduler did not reach expected state: ${id}`)
}
