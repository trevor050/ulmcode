import fs from "node:fs/promises"
import path from "node:path"

type WorkerSpec = {
  operationID: string
  executionID: string
  attempt: number
  profileID: string
  artifactDirectory: string
  command: string
  args: string[]
  timeoutMs: number
  maxOutputBytes: number
  credentialKeys: string[]
}
type Result = { status: "succeeded" | "failed" | "interrupted"; summary: string; artifactRefs: Array<{ path: string; mediaType: string }> }

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
let interrupted = false
let timedOut = false
let child: ReturnType<typeof Bun.spawn> | undefined

process.on("SIGUSR1", () => {
  interrupted = true
  terminate()
})
process.on("SIGTERM", () => {
  interrupted = true
  terminate()
})

await writePrivate(stateFile, JSON.stringify({ schemaVersion: 1, operationID: spec.operationID, executionID: spec.executionID, profileID: spec.profileID, status: "running", pid: process.pid, startedAt: new Date().toISOString(), artifactRefs: [] }))
await writePrivate(readyFile, String(process.pid))

try {
  if (interrupted) throw new Error("command was interrupted before dispatch")
  child = Bun.spawn([spec.command, ...spec.args], {
    cwd: directory,
    env: { ...process.env, ...credentials },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
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
    : timedOut
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
  try { process.kill(-child.pid, "SIGTERM") } catch { child.kill("SIGTERM") }
  setTimeout(() => {
    try { process.kill(-child.pid, "SIGKILL") } catch { child.kill("SIGKILL") }
  }, 500).unref()
}

async function writePrivate(file: string, content: string) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, `${content}${content.endsWith("\n") ? "" : "\n"}`, { mode: 0o600 })
  await fs.chmod(temporary, 0o600)
  await fs.rename(temporary, file)
}
