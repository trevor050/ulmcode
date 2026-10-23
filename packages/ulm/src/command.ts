import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { materializeCredential } from "./credentials"
import type { ArtifactRef, ExecutionAdapter, ExecutionObservation, LaunchRequest, OperationPhase } from "./operation"
import { LoopbackLabAdapter } from "./lab"

type CommandProfile = {
  profileID: string
  safety: "non_destructive"
  scopes: Array<"synthetic_lab" | "authorized">
  executable: string
  args: string[]
  variables: Record<string, "target" | "literal">
  targetPolicy: "loopback" | "scoped"
  timeoutMs: number
  maxOutputBytes: number
  restart: "safe" | "inspect_first" | "never"
}

type CommandCatalog = { schemaVersion: 1; profiles: CommandProfile[] }
type WorkerSpec = { operationID: string; executionID: string; attempt: number; profileID: string; artifactDirectory: string; command: string; args: string[]; timeoutMs: number; maxOutputBytes: number; credentialKeys: string[] }
type ReceiptState = { schemaVersion: 1; operationID: string; executionID: string; profileID: string; status: ExecutionObservation["status"]; summary?: string; pid?: number; processStart?: string; startedAt?: string; endedAt?: string; artifactRefs: ArtifactRef[] }
type WorkerIdentity = { pid: number; processStart: string }

const secretName = /(pass(word)?|secret|token|credential|auth(orization)?|api.?key|private.?key)/i
const sensitiveValue = /(bearer\s+\S+|(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+)/i
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"])

export class CommandCatalogError extends Error {
  constructor(message: string) { super(message); this.name = "CommandCatalogError" }
}

/** Executes only profiles explicitly loaded from a trusted catalog file. */
export class SupervisedCommandAdapter implements ExecutionAdapter {
  readonly id = "supervised-command-v1"
  readonly #catalog: Map<string, CommandProfile>
  readonly #credentialsDir?: string
  readonly #workerPath: string
  readonly #bunPath: string

  constructor(input: { catalogPath: string; credentialsDir?: string; workerPath?: string; bunPath?: string }) {
    const catalogPath = realpathSync(input.catalogPath)
    const parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as CommandCatalog
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.profiles)) throw new CommandCatalogError("command catalog schema is invalid")
    this.#catalog = new Map(parsed.profiles.map((profile) => {
      validateProfile(profile)
      return [profile.profileID, profile]
    }))
    if (this.#catalog.size !== parsed.profiles.length) throw new CommandCatalogError("command catalog profile ids must be unique")
    this.#credentialsDir = input.credentialsDir
    this.#workerPath = input.workerPath ?? path.resolve(import.meta.dir, "command-worker.ts")
    this.#bunPath = input.bunPath ?? process.env.ULMCODE_BUN_PATH ?? process.execPath
    let hasBunRuntime = false
    try {
      const runtimeProbe = Bun.spawnSync([this.#bunPath, "-e", "process.stdout.write(typeof Bun === 'undefined' ? 'no' : 'yes')"], { stdout: "pipe", stderr: "ignore" })
      hasBunRuntime = runtimeProbe.exitCode === 0 && runtimeProbe.stdout.toString().trim() === "yes"
    } catch { /* Report a stable configuration error for missing or non-runnable host binaries. */ }
    if (!hasBunRuntime) throw new CommandCatalogError("a Bun runtime is required for supervised workers; set ULMCODE_BUN_PATH to its executable")
  }

  receipt(request: LaunchRequest) {
    return `cmd1:${Buffer.from(path.resolve(request.artifactDirectory)).toString("base64url")}:${request.operationID}:${request.executionID}:${request.attempt}`
  }

  hasProfile(profileID: string) {
    return this.#catalog.has(profileID)
  }

  validatePhase(request: LaunchRequest) {
    const command = request.phase.command
    if (!command) throw new CommandCatalogError("command phase metadata is required")
    const profile = this.#catalog.get(command.profileID)
    if (!profile) throw new CommandCatalogError(`command profile is not present in the trusted catalog: ${command.profileID}`)
    if (!(profile.executable.includes("/") ? existsSync(profile.executable) : Bun.which(profile.executable))) throw new CommandCatalogError("catalog executable is missing from the host")
    if (!profile.scopes.includes(request.scope.mode)) throw new CommandCatalogError("command profile does not permit this operation scope")
    if (profile.targetPolicy === "loopback" && !request.scope.targets.every(isLoopbackTarget)) throw new CommandCatalogError("command profile accepts loopback targets only")
    if (Object.keys(command.variables).some((name) => !Object.hasOwn(profile.variables, name))) throw new CommandCatalogError("phase contains variables outside the command profile")
    for (const [name, value] of Object.entries(command.variables)) {
      if (secretName.test(name) || sensitiveValue.test(value) || value.length > 2048 || /[\u0000-\u001f]/.test(value)) throw new CommandCatalogError("command variables must be bounded, non-secret values")
      if (profile.variables[name] === "target" && !request.scope.targets.includes(value)) throw new CommandCatalogError("command target variable is outside operation scope")
      if (profile.variables[name] === "literal" && /https?:\/\//i.test(value)) throw new CommandCatalogError("literal variables cannot introduce a target")
    }
    for (const arg of profile.args) {
      const placeholders = [...arg.matchAll(/\{\{([^{}]+)\}\}/g)]
      for (const match of placeholders) {
        const name = match[1]!
        if (name !== "executionID" && name !== "operationID" && !Object.hasOwn(profile.variables, name)) throw new CommandCatalogError(`command arguments contain an unknown template: ${name}`)
        if (name !== "executionID" && name !== "operationID" && command.variables[name] === undefined) throw new CommandCatalogError(`missing command variable: ${name}`)
      }
      if (arg.replace(/\{\{[^{}]+\}\}/g, "").includes("{{") || arg.replace(/\{\{[^{}]+\}\}/g, "").includes("}}")) throw new CommandCatalogError("command arguments contain a malformed template")
    }
    return profile
  }

  async launch(request: LaunchRequest) {
    const receipt = this.receipt(request)
    const stateFile = this.#stateFile(request.artifactDirectory, request.executionID, request.attempt)
    if (await readState(stateFile)) {
      const prior = await this.#knownObservation(receipt)
      if (prior.status === "unknown") throw new Error(prior.summary ?? "existing command outcome is unknown; refusing duplicate dispatch")
      return { receipt }
    }
    const prepared = await this.#prepare(request)
    const privateDir = this.#privateDirectory(request.artifactDirectory, request.operationID)
    await fs.mkdir(privateDir, { recursive: true, mode: 0o700 })
    await fs.chmod(privateDir, 0o700)
    const specFile = path.join(privateDir, `${request.executionID}-attempt-${request.attempt}.json`)
    try {
      await exclusiveWrite(path.join(privateDir, `${request.executionID}-attempt-${request.attempt}.claim`), "claimed")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const prior = await this.#knownObservation(receipt)
      if (prior.status !== "unknown") return { receipt }
      throw new Error(prior.summary ?? "execution claim exists without a confirmed outcome; refusing duplicate dispatch")
    }
    await atomicWrite(stateFile, JSON.stringify({ schemaVersion: 1, operationID: request.operationID, executionID: request.executionID, profileID: prepared.profile.profileID, status: "running", startedAt: new Date().toISOString(), artifactRefs: [] } satisfies ReceiptState))
    await atomicWrite(specFile, JSON.stringify(prepared.spec))
    const env = minimalEnv(prepared.env, prepared.spec.credentialKeys)
    const child = Bun.spawn([this.#bunPath, this.#workerPath, specFile], { cwd: request.artifactDirectory, env, stdio: ["ignore", "ignore", "ignore"], detached: true })
    const pid = child.pid
    const readyFile = path.join(privateDir, `${request.executionID}-attempt-${request.attempt}.ready`)
    const readyDeadline = Date.now() + 10_000
    while (Date.now() < readyDeadline && !(await Bun.file(readyFile).exists())) await Bun.sleep(10)
    if (!(await Bun.file(readyFile).exists())) {
      const terminal = await this.#terminalObservation(request.artifactDirectory, request.operationID, request.executionID, request.attempt, prepared.profile.profileID)
      if (terminal) {
        child.unref()
        return { receipt }
      }
      child.kill()
      const current = await readState(stateFile)
      if (current?.status === "running") await atomicWrite(stateFile, JSON.stringify({ ...current, status: "unknown", summary: "worker readiness handshake failed", endedAt: new Date().toISOString() } satisfies ReceiptState))
      throw new Error("supervised worker did not complete its readiness handshake")
    }
    await fs.rm(readyFile, { force: true })
    const completed = await readState(stateFile)
    if (completed?.status !== "running") {
      child.unref()
      return { receipt }
    }
    const processStart = await processIdentity(pid)
    if (!processStart) {
      const final = await readState(stateFile)
      if (final?.status !== "running") {
        child.unref()
        return { receipt }
      }
      child.kill()
      await atomicWrite(stateFile, JSON.stringify({ schemaVersion: 1, operationID: request.operationID, executionID: request.executionID, profileID: prepared.profile.profileID, status: "unknown", summary: "worker identity could not be established", artifactRefs: [] } satisfies ReceiptState))
      throw new Error("supervised worker identity could not be established")
    }
      await atomicWrite(this.#identityFile(request.artifactDirectory, request.operationID, request.executionID, request.attempt), JSON.stringify({ pid, processStart } satisfies WorkerIdentity))
    child.unref()
    return { receipt }
  }

  async inspect(receipt: string): Promise<ExecutionObservation> {
    const parsed = parseReceipt(receipt)
    if (!parsed) return { status: "unknown", artifactRefs: [], summary: "command receipt is malformed" }
    const saved = await readState(this.#stateFile(parsed.directory, parsed.executionID, parsed.attempt))
    if (!saved || saved.operationID !== parsed.operationID || saved.executionID !== parsed.executionID) return { status: "unknown", artifactRefs: [], summary: "command receipt has no matching durable state" }
    if (saved.status !== "running") {
      await fs.rm(this.#identityFile(parsed.directory, parsed.operationID, parsed.executionID, parsed.attempt), { force: true })
      await fs.rm(this.#readyFile(parsed.directory, parsed.operationID, parsed.executionID, parsed.attempt), { force: true })
      await fs.rm(this.#claimFile(parsed.directory, parsed.operationID, parsed.executionID, parsed.attempt), { force: true })
      return { status: saved.status, artifactRefs: saved.artifactRefs, summary: saved.summary, checkpointRef: this.#relativeState(parsed.executionID, parsed.attempt) }
    }
    const identity = await readIdentity(this.#identityFile(parsed.directory, parsed.operationID, parsed.executionID, parsed.attempt))
    if (!identity) return { status: "unknown", artifactRefs: [], summary: "running command has no durable process identity" }
    if (await processIdentity(identity.pid) !== identity.processStart) {
      const workerResult = await readWorkerResult(parsed.directory, parsed.executionID, parsed.attempt)
      if (workerResult) {
        const observation = { status: workerResult.status, artifactRefs: workerResult.artifactRefs, summary: workerResult.summary, checkpointRef: this.#relativeState(parsed.executionID, parsed.attempt) }
        await this.#finishState(parsed.directory, saved, observation, parsed.attempt)
        await fs.rm(this.#identityFile(parsed.directory, parsed.operationID, parsed.executionID, parsed.attempt), { force: true })
        return observation
      }
      const observation: ExecutionObservation = { status: "unknown", artifactRefs: [], summary: "worker is absent and no durable exit record exists" }
      await this.#finishState(parsed.directory, saved, observation, parsed.attempt)
      return observation
    }
    return { status: "running", artifactRefs: saved.artifactRefs, checkpointRef: this.#relativeState(parsed.executionID, parsed.attempt) }
  }

  async interrupt(receipt?: string, request?: LaunchRequest) {
    const key = receipt ?? (request ? this.receipt(request) : undefined)
    const parsed = key && parseReceipt(key)
    if (!parsed) return
    const saved = await readState(this.#stateFile(parsed.directory, parsed.executionID, parsed.attempt))
    const identity = await readIdentity(this.#identityFile(parsed.directory, parsed.operationID, parsed.executionID, parsed.attempt))
    if (!saved || saved.status !== "running" || !identity) return
    if (await processIdentity(identity.pid) !== identity.processStart) return
    process.kill(identity.pid, "SIGUSR1")
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const current = await readState(this.#stateFile(parsed.directory, parsed.executionID, parsed.attempt))
      if (current?.status !== "running") return
      await Bun.sleep(25)
    }
    const current = await readState(this.#stateFile(parsed.directory, parsed.executionID, parsed.attempt))
    if (current?.status === "running" && await processIdentity(identity.pid) === identity.processStart) process.kill(identity.pid, "SIGUSR1")
  }

  async recover(request: LaunchRequest, receipt?: string) {
    const key = receipt ?? this.receipt(request)
    const current = await this.inspect(key)
    if (current.status === "running" || current.status === "succeeded") return { receipt: key }
    if (current.status === "failed" || current.status === "interrupted") {
      const profile = request.phase.command && this.#catalog.get(request.phase.command.profileID)
      if (request.phase.restart !== "safe" || profile?.restart !== "safe") return undefined
      return this.launch({ ...request, attempt: request.attempt + 1 })
    }
    if (current.status === "unknown") return undefined
    return this.launch(request)
  }

  async #prepare(request: LaunchRequest) {
    const command = request.phase.command
    if (!command) throw new Error("command phase metadata is required")
    const profile = this.validatePhase(request)
    const args = profile.args.map((arg) => arg.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_match, name: string) => {
      if (name === "executionID") return request.executionID
      if (name === "operationID") return request.operationID
      const value = command.variables[name]
      if (value === undefined) throw new CommandCatalogError(`missing command variable: ${name}`)
      return value
    }))
    if (args.some((arg) => /\{\{[^}]+\}\}/.test(arg))) throw new CommandCatalogError("command arguments contain an unknown template")
    if (profile.executable.includes("/") && !existsSync(profile.executable)) throw new CommandCatalogError("catalog executable is missing")
    const credentials = await Promise.all((command.credentialHandles ?? []).map(async (credentialID) => {
      if (!this.#credentialsDir) throw new Error("credential handles require a private credential store")
      if (request.scope.targets.length !== 1) throw new Error("credential handles require exactly one scoped target")
      return materializeCredential({ credentialsDir: this.#credentialsDir, operationRoot: request.artifactDirectory, operationID: request.operationID, credentialID: credentialID as `cred_${string}`, target: request.scope.targets[0]!, executionID: request.executionID })
    }))
    const env = Object.assign({}, ...credentials)
    const secretValues = Object.values(env).filter((value): value is string => Boolean(value))
    const interpolatedArgs = profile.args.flatMap((arg, index) => arg.includes("{{") ? [args[index]!] : [])
    if ([...Object.values(command.variables), ...interpolatedArgs].some((value) => secretValues.some((secret) => value.includes(secret)))) throw new CommandCatalogError("credential values cannot appear in phase variables or command arguments")
    if (secretValues.some((value) => value.length > 4096)) throw new CommandCatalogError("credential values exceed the worker redaction bound")
    return { profile, spec: { operationID: request.operationID, executionID: request.executionID, attempt: request.attempt, profileID: profile.profileID, artifactDirectory: request.artifactDirectory, command: profile.executable, args, timeoutMs: profile.timeoutMs, maxOutputBytes: profile.maxOutputBytes, credentialKeys: Object.keys(env) } satisfies WorkerSpec, env }
  }

  #stateFile(directory: string, executionID: string, attempt: number) { return path.join(directory, "commands", `${executionID}-attempt-${attempt}.json`) }
  #privateDirectory(directory: string, operationID: string) { return path.join(path.dirname(path.dirname(directory)), "supervision", operationID) }
  #identityFile(directory: string, operationID: string, executionID: string, attempt: number) { return path.join(this.#privateDirectory(directory, operationID), `${executionID}-attempt-${attempt}.worker.json`) }
  #readyFile(directory: string, operationID: string, executionID: string, attempt: number) { return path.join(this.#privateDirectory(directory, operationID), `${executionID}-attempt-${attempt}.ready`) }
  #claimFile(directory: string, operationID: string, executionID: string, attempt: number) { return path.join(this.#privateDirectory(directory, operationID), `${executionID}-attempt-${attempt}.claim`) }
  #relativeState(executionID: string, attempt: number) { return `commands/${executionID}-attempt-${attempt}.json` }

  async #finishState(directory: string, prior: ReceiptState, observation: ExecutionObservation, attempt: number) {
    await atomicWrite(this.#stateFile(directory, prior.executionID, attempt), JSON.stringify({ ...prior, status: observation.status, summary: observation.summary, endedAt: new Date().toISOString(), artifactRefs: observation.artifactRefs } satisfies ReceiptState))
  }

  async #knownObservation(receipt: string) {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const observation = await this.inspect(receipt)
      if (observation.status !== "unknown") return observation
      await Bun.sleep(10)
    }
    return this.inspect(receipt)
  }

  async #terminalObservation(directory: string, operationID: string, executionID: string, attempt: number, profileID: string) {
    const current = await readState(this.#stateFile(directory, executionID, attempt))
    if (current && current.status !== "running") return current
    const workerResult = await readWorkerResult(directory, executionID, attempt)
    if (!workerResult || workerResult.status === "running") return undefined
    const terminal = { schemaVersion: 1, operationID, executionID, profileID, status: workerResult.status, summary: workerResult.summary, endedAt: workerResult.endedAt ?? new Date().toISOString(), artifactRefs: workerResult.artifactRefs } satisfies ReceiptState
    await atomicWrite(this.#stateFile(directory, executionID, attempt), JSON.stringify(terminal))
    return terminal
  }
}

export class CompositeExecutionAdapter implements ExecutionAdapter {
  readonly id = "composite-command-loopback-v1"
  readonly #commands: SupervisedCommandAdapter
  readonly #loopback: ExecutionAdapter
  readonly #owners = new Map<string, ExecutionAdapter>()
  constructor(input: { commands: SupervisedCommandAdapter; loopback?: ExecutionAdapter }) {
    this.#commands = input.commands
    this.#loopback = input.loopback ?? new LoopbackLabAdapter()
  }
  validatePhase(request: LaunchRequest) {
    if (request.phase.command) this.#commands.validatePhase(request)
  }
  receipt(request: LaunchRequest) {
    const adapter = this.#select(request.phase)
    this.#owners.set(adapter.receipt(request), adapter)
    return adapter.receipt(request)
  }
  launch(request: LaunchRequest) { const adapter = this.#select(request.phase); const receipt = adapter.receipt(request); this.#owners.set(receipt, adapter); return adapter.launch(request) }
  inspect(receipt: string) { return this.#adapter(receipt).inspect(receipt) }
  interrupt(receipt?: string, request?: LaunchRequest) { const adapter = receipt ? this.#adapter(receipt) : this.#select(request?.phase); return adapter.interrupt(receipt, request) }
  recover(request: LaunchRequest, receipt?: string) { const adapter = this.#select(request.phase); if (receipt) this.#owners.set(receipt, adapter); return adapter.recover(request, receipt) }
  #select(phase?: OperationPhase) { return phase?.command ? this.#commands : this.#loopback }
  #adapter(receipt: string) {
    const owner = this.#owners.get(receipt)
    if (owner) return owner
    const adapter = receipt.startsWith("cmd1:") ? this.#commands : this.#loopback
    this.#owners.set(receipt, adapter)
    return adapter
  }
}

function validateProfile(profile: CommandProfile) {
  if (!profile || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(profile.profileID) || profile.safety !== "non_destructive" || !Array.isArray(profile.scopes) || !profile.scopes.length || profile.scopes.some((scope) => scope !== "authorized" && scope !== "synthetic_lab")) throw new CommandCatalogError("command profile identity, safety, or scopes are invalid")
  if (!profile.executable || /[\u0000-\u001f]/.test(profile.executable) || !Array.isArray(profile.args) || profile.args.some((arg) => typeof arg !== "string" || /[\u0000\r\n]/.test(arg))) throw new CommandCatalogError(`command profile ${profile.profileID} has an invalid argv vector`)
  if (profile.targetPolicy !== "loopback" && profile.targetPolicy !== "scoped") throw new CommandCatalogError(`command profile ${profile.profileID} has invalid target policy`)
  if (profile.restart !== "safe" && profile.restart !== "inspect_first" && profile.restart !== "never") throw new CommandCatalogError(`command profile ${profile.profileID} has invalid restart policy`)
  if (!profile.variables || typeof profile.variables !== "object" || Object.entries(profile.variables).some(([name, value]) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || value !== "target" && value !== "literal")) throw new CommandCatalogError(`command profile ${profile.profileID} has invalid variable declarations`)
  if (!Number.isInteger(profile.timeoutMs) || profile.timeoutMs < 100 || profile.timeoutMs > 600_000 || !Number.isInteger(profile.maxOutputBytes) || profile.maxOutputBytes < 1024 || profile.maxOutputBytes > 5_000_000) throw new CommandCatalogError(`command profile ${profile.profileID} exceeds resource bounds`)
}

function isLoopbackTarget(value: string) {
  try { const url = new URL(value); return url.protocol === "http:" && LOOPBACK.has(url.hostname) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash }
  catch { return false }
}

function parseReceipt(receipt: string) {
  const match = receipt.match(/^cmd1:([A-Za-z0-9_-]+):([a-z0-9_-]{1,80}):([A-Za-z0-9_-]{1,128}):([1-9][0-9]{0,5})$/)
  if (!match) return undefined
  const directory = path.resolve(Buffer.from(match[1]!, "base64url").toString())
  if (path.basename(path.dirname(directory)) !== "operations" || path.basename(directory) !== match[2]) return undefined
  return { directory, operationID: match[2]!, executionID: match[3]!, attempt: Number(match[4]) }
}

async function readState(file: string): Promise<ReceiptState | undefined> {
  try { return JSON.parse(await Bun.file(file).text()) as ReceiptState }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined; throw error }
}

async function readIdentity(file: string): Promise<WorkerIdentity | undefined> {
  try { return JSON.parse(await Bun.file(file).text()) as WorkerIdentity }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error }
}

async function readWorkerResult(directory: string, executionID: string, attempt: number) {
  try {
    return JSON.parse(await Bun.file(path.join(directory, "commands", `${executionID}-attempt-${attempt}.result.json`)).text()) as ReceiptState
  } catch { return undefined }
}

async function processIdentity(pid: number) {
  try {
    const [stat, cmdline] = await Promise.all([Bun.file(`/proc/${pid}/stat`).text(), Bun.file(`/proc/${pid}/cmdline`).text()])
    const start = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19]
    if (!cmdline.includes("command-worker.ts")) return undefined
    return `${start}:${createHash("sha256").update(cmdline).digest("hex").slice(0, 12)}`
  } catch { return undefined }
}

async function atomicWrite(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temp, `${content}\n`, { mode: 0o600 })
  await fs.chmod(temp, 0o600)
  await fs.rename(temp, file)
}

async function exclusiveWrite(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const handle = await fs.open(file, "wx", 0o600)
  await handle.writeFile(`${content}\n`)
  await handle.close()
}

function minimalEnv(credentials: Record<string, string>, credentialKeys: string[]) {
  const inherited = Object.fromEntries(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SYSTEMROOT", "WINDIR"].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
  return { ...inherited, ...credentials, ULMCODE_COMMAND_CREDENTIAL_KEYS: credentialKeys.join(",") }
}
