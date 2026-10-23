import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

type WorkerSpec = {
  operationID: string
  executionID: string
  attempt: number
  profileID: string
  artifactDirectory: string
  privateDirectory: string
  command: string
  args: string[]
  timeoutMs: number
  maxOutputBytes: number
  credentialKeys: string[]
}
type Result = { status: "succeeded" | "failed" | "interrupted"; summary: string; artifactRefs: Array<{ path: string; mediaType: string }> }
type CommandIdentity = { pid: number; processStart: string; processGroupID: number; watchdogPID: number; watchdogStart: string; deadlineAt: string }
type GuardSpec = { operationID: string; executionID: string; attempt: number; commandPID: number; commandStart: string; processGroupID: number; workerPID: number; workerStart: string; deadlineAt: string; killGraceMs: number; readyFile: string; ackFile: string; resultFile: string; workerResultFile: string }

if (process.argv[2] === "--guard") {
  await runGuard(process.argv[3]!)
  process.exit(0)
}

const specFile = process.argv[2]
if (!specFile) process.exit(64)
const spec = JSON.parse(await Bun.file(specFile).text()) as WorkerSpec
const credentials = Object.fromEntries(spec.credentialKeys.flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
const secrets = [...new Set(Object.values(credentials).filter(Boolean))].sort((a, b) => b.length - a.length)
for (const key of spec.credentialKeys) delete process.env[key]
delete process.env.ULMCODE_COMMAND_CREDENTIAL_KEYS
const directory = spec.artifactDirectory
const commandDir = path.join(directory, "commands")
await fs.mkdir(commandDir, { recursive: true, mode: 0o700 })
const commandID = `${spec.executionID}-attempt-${spec.attempt}`
const stdoutFile = path.join(commandDir, `${commandID}.stdout.txt`)
const stderrFile = path.join(commandDir, `${commandID}.stderr.txt`)
const resultFile = path.join(commandDir, `${commandID}.result.json`)
const stateFile = path.join(commandDir, `${commandID}.json`)
const readyFile = path.join(path.dirname(specFile), `${commandID}.ready`)
const commandIdentityFile = path.join(spec.privateDirectory, `${commandID}.command.json`)
const guardSpecFile = path.join(spec.privateDirectory, `${commandID}.guard.json`)
const guardReadyFile = path.join(spec.privateDirectory, `${commandID}.guard.ready`)
const guardAckFile = path.join(spec.privateDirectory, `${commandID}.guard.ack`)
const guardResultFile = path.join(spec.privateDirectory, `${commandID}.guard.result.json`)
let interrupted = false
let timedOut = false
let child: ReturnType<typeof Bun.spawn> | undefined
let commandProcessGroupID: number | undefined

process.on("SIGUSR1", () => {
  interrupted = true
  terminate()
})
process.on("SIGTERM", () => {
  interrupted = true
  terminate()
})

await writePrivate(stateFile, JSON.stringify({ schemaVersion: 1, operationID: spec.operationID, executionID: spec.executionID, profileID: spec.profileID, status: "running", pid: process.pid, startedAt: new Date().toISOString(), artifactRefs: [] }))

try {
  if (interrupted) throw new Error("command was interrupted before dispatch")
  child = Bun.spawn([spec.command, ...spec.args], {
    cwd: directory,
    env: { ...process.env, ...credentials },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  const commandInfo = await processInfo(child.pid)
  if (!commandInfo) throw new Error("command process identity could not be established")
  commandProcessGroupID = commandInfo.processGroupID
  const workerInfo = await processInfo(process.pid)
  if (!workerInfo) throw new Error("worker process identity could not be established")
  const deadlineAt = new Date(Date.now() + spec.timeoutMs).toISOString()
  const guardSpec: GuardSpec = { operationID: spec.operationID, executionID: spec.executionID, attempt: spec.attempt, commandPID: child.pid, commandStart: commandInfo.processStart, processGroupID: commandInfo.processGroupID, workerPID: process.pid, workerStart: workerInfo.processStart, deadlineAt, killGraceMs: 500, readyFile: guardReadyFile, ackFile: guardAckFile, resultFile: guardResultFile, workerResultFile: resultFile }
  await writePrivate(guardSpecFile, JSON.stringify(guardSpec))
  Bun.spawn([process.execPath, import.meta.path, "--guard", guardSpecFile], { cwd: directory, env: process.env, stdio: ["ignore", "ignore", "ignore"], detached: true })
  const guardReadyDeadline = Date.now() + 3000
  while (Date.now() < guardReadyDeadline && !(await Bun.file(guardReadyFile).exists())) await Bun.sleep(10)
  if (!(await Bun.file(guardReadyFile).exists())) throw new Error("independent timeout guard did not become ready")
  const guardPID = Number((await Bun.file(guardReadyFile).text()).trim())
  const guardInfo = Number.isSafeInteger(guardPID) ? await processInfo(guardPID) : undefined
  if (!guardInfo) throw new Error("timeout guard identity could not be established")
  await writePrivate(commandIdentityFile, JSON.stringify({ pid: child.pid, processStart: commandInfo.processStart, processGroupID: commandInfo.processGroupID, watchdogPID: guardPID, watchdogStart: guardInfo.processStart, deadlineAt } satisfies CommandIdentity))
  await writePrivate(guardAckFile, "ready")
  await writePrivate(readyFile, String(process.pid))
  if (interrupted) terminate()
  if (!(child.stdout instanceof ReadableStream) || !(child.stderr instanceof ReadableStream)) throw new Error("command output pipes were not created")
  const timeout = setTimeout(() => {
    timedOut = true
    terminate()
  }, spec.timeoutMs)
  const stdout = capture(child.stdout, spec.maxOutputBytes, secrets)
  const stderr = capture(child.stderr, spec.maxOutputBytes, secrets)
  const exitCode = await child.exited
  const [out, err] = await Promise.all([stdout, stderr])
  clearTimeout(timeout)
  const result: Result = interrupted
    ? { status: "interrupted", summary: "command execution was interrupted", artifactRefs: [] }
    : timedOut || exitCode === 124
        ? { status: "failed", summary: "command exceeded its configured time limit", artifactRefs: [] }
        : exitCode === 0
          ? { status: "succeeded", summary: "command completed with exit code 0", artifactRefs: [] }
          : { status: "failed", summary: `command exited with code ${exitCode}`, artifactRefs: [] }
  await writePrivate(stdoutFile, out)
  await writePrivate(stderrFile, err)
  result.artifactRefs.push(
    { path: `commands/${commandID}.stdout.txt`, mediaType: "text/plain" },
    { path: `commands/${commandID}.stderr.txt`, mediaType: "text/plain" },
  )
  await writePrivate(resultFile, JSON.stringify(result))
  await writePrivate(stateFile, JSON.stringify({ schemaVersion: 1, operationID: spec.operationID, executionID: spec.executionID, profileID: spec.profileID, status: result.status, summary: result.summary, endedAt: new Date().toISOString(), artifactRefs: result.artifactRefs }))
} catch {
  const result: Result = { status: interrupted ? "interrupted" : "failed", summary: interrupted ? "command execution was interrupted" : "command worker failed before recording a successful exit", artifactRefs: [] }
  await writePrivate(stdoutFile, "")
  await writePrivate(stderrFile, "")
  result.artifactRefs.push(
    { path: `commands/${commandID}.stdout.txt`, mediaType: "text/plain" },
    { path: `commands/${commandID}.stderr.txt`, mediaType: "text/plain" },
  )
  await writePrivate(resultFile, JSON.stringify(result))
  await writePrivate(stateFile, JSON.stringify({ schemaVersion: 1, operationID: spec.operationID, executionID: spec.executionID, profileID: spec.profileID, status: result.status, summary: result.summary, endedAt: new Date().toISOString(), artifactRefs: result.artifactRefs }))
} finally {
  await fs.rm(specFile, { force: true })
}

async function capture(stream: ReadableStream<Uint8Array>, maxBytes: number, values: string[]) {
  const decoder = new TextDecoder()
  let text = ""
  let size = 0
  let pending = ""
  const overlap = Math.max(0, ...values.map((value) => value.length - 1))
  for await (const chunk of stream) {
    const safe = redact(pending + decoder.decode(chunk, { stream: true }), values)
    const split = Math.max(0, safe.length - overlap)
    const bytes = Buffer.from(safe.slice(0, split))
    const remaining = maxBytes - size
    if (remaining > 0) {
      const part = bytes.subarray(0, remaining)
      text += part.toString("utf8")
      size += part.byteLength
    }
    pending = safe.slice(split)
  }
  const tail = Buffer.from(redact(pending + decoder.decode(), values, true))
  if (size < maxBytes) text += tail.subarray(0, maxBytes - size).toString("utf8")
  return text
}

function redact(value: string, secrets: string[], final = false) {
  const redacted = secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), value)
  if (!final) return redacted
  const partial = secrets.flatMap((secret) => Array.from({ length: secret.length - 1 }, (_item, index) => secret.slice(0, index + 1)))
    .filter((prefix) => redacted.endsWith(prefix))
    .sort((left, right) => right.length - left.length)[0]
  return partial ? redacted.slice(0, -partial.length) + "[REDACTED]" : redacted
}

function terminate() {
  if (!child) return
  try { commandProcessGroupID ? process.kill(-commandProcessGroupID, "SIGTERM") : child.kill("SIGTERM") } catch { child.kill("SIGTERM") }
  setTimeout(() => {
    try { commandProcessGroupID ? process.kill(-commandProcessGroupID, "SIGKILL") : child?.kill("SIGKILL") } catch { child?.kill("SIGKILL") }
  }, 500).unref()
}

async function processIdentity(pid: number, expectedCommand?: string) {
  const info = await processInfo(pid)
  if (!info) return undefined
  if (expectedCommand) {
    try { if (!(await Bun.file(`/proc/${pid}/cmdline`).text()).includes(expectedCommand)) return undefined }
    catch { return undefined }
  }
  return info.processStart
}

async function processInfo(pid: number) {
  try {
    const [stat, cmdline] = await Promise.all([Bun.file(`/proc/${pid}/stat`).text(), Bun.file(`/proc/${pid}/cmdline`).text()])
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)
    if (fields[0] === "Z") return undefined
    return { processStart: `${fields[19]}:${createHash("sha256").update(cmdline).digest("hex").slice(0, 12)}`, processGroupID: Number(fields[2]), startTicks: fields[19]! }
  } catch { return undefined }
}

async function runGuard(file: string) {
  const spec = JSON.parse(await Bun.file(file).text()) as GuardSpec
  let interrupted = false
  process.on("SIGUSR1", () => { interrupted = true })
  await writePrivate(spec.readyFile, String(process.pid))
  const ackDeadline = Date.now() + 3000
  while (Date.now() < ackDeadline && !(await Bun.file(spec.ackFile).exists())) await Bun.sleep(10)
  if (!(await Bun.file(spec.ackFile).exists())) return
  const deadline = Date.parse(spec.deadlineAt)
  while (true) {
    const members = await processGroupMembers(spec.processGroupID)
    if (!members.length) {
      await writeGuardResultIfWorkerGone(spec, interrupted ? "interrupted" : "failed", interrupted ? "command was interrupted after worker loss; output capture was unavailable" : "worker exited before recording a command result; output capture was unavailable")
      return
    }
    if (interrupted || Date.now() >= deadline) {
      await signalGroup(spec.processGroupID, "SIGTERM")
      await Bun.sleep(spec.killGraceMs)
      await signalGroup(spec.processGroupID, "SIGKILL")
      const cleanupDeadline = Date.now() + 2500
      while (Date.now() < cleanupDeadline && (await processGroupMembers(spec.processGroupID)).length) await Bun.sleep(20)
      if (!(await processGroupMembers(spec.processGroupID)).length) {
        await writeGuardResultIfWorkerGone(spec, interrupted ? "interrupted" : "failed", interrupted ? "command was interrupted after worker loss; output capture was unavailable" : "command exceeded its configured time limit after worker loss; output capture was unavailable")
      }
      return
    }
    await Bun.sleep(20)
  }
}

async function writeGuardResultIfWorkerGone(spec: GuardSpec, status: Result["status"], summary: string) {
  if (await processIdentity(spec.workerPID) === spec.workerStart) return
  if (await Bun.file(spec.workerResultFile).exists()) return
  await writePrivate(spec.resultFile, JSON.stringify({ status, summary, artifactRefs: [] } satisfies Result))
}

async function processGroupMembers(processGroupID: number) {
  const entries = await fs.readdir("/proc").catch(() => [])
  return (await Promise.all(entries.filter((entry) => /^\d+$/.test(entry)).map(async (entry) => {
    const pid = Number(entry)
    const info = await processInfo(pid)
    return info?.processGroupID === processGroupID ? { pid, startTicks: info.startTicks } : undefined
  }))).filter((member): member is { pid: number; startTicks: string } => Boolean(member))
}

async function signalGroup(processGroupID: number, signal: NodeJS.Signals) {
  for (const member of await processGroupMembers(processGroupID)) {
    const current = await processInfo(member.pid)
    if (current?.processGroupID !== processGroupID || current.startTicks !== member.startTicks) continue
    try { process.kill(member.pid, signal) } catch {}
  }
}

async function writePrivate(file: string, content: string) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, `${content}${content.endsWith("\n") ? "" : "\n"}`, { mode: 0o600 })
  await fs.chmod(temporary, 0o600)
  await fs.rename(temporary, file)
}
