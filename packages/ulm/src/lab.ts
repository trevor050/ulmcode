import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Buffer } from "node:buffer"
import type { ArtifactRef, ExecutionAdapter, ExecutionObservation, LaunchRequest } from "./operation"

type LabPayload = { lab: string; observations: Array<{ kind: string; subject?: string; summary: string; confidence?: number }> }

const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "::1"])

export class LoopbackLabAdapter implements ExecutionAdapter {
  readonly id = "loopback-lab-v1"
  readonly #observations = new Map<string, ExecutionObservation>()
  readonly #controllers = new Map<string, AbortController>()
  readonly #timeoutMs: number

  constructor(input: { timeoutMs?: number } = {}) {
    this.#timeoutMs = input.timeoutMs ?? 5000
  }

  validatePhase(request: LaunchRequest) {
    if (request.phase.command) throw new Error("command phase requires an explicitly configured supervised command catalog")
    this.#target(request.scope.targets)
  }

  receipt(request: LaunchRequest) {
    this.validatePhase(request)
    const encodedDirectory = Buffer.from(path.resolve(request.artifactDirectory)).toString("base64url")
    return `lab1:${encodedDirectory}:${request.operationID}:${request.executionID}`
  }

  async launch(request: LaunchRequest): Promise<{ receipt: string }> {
    this.validatePhase(request)
    const receipt = this.receipt(request)
    const prior = await this.inspect(receipt)
    if (prior?.status === "succeeded" || prior?.status === "running") return { receipt }
    const controller = new AbortController()
    this.#controllers.set(receipt, controller)
    await this.#save(request.artifactDirectory, request.operationID, request.executionID, { status: "running", artifactRefs: [] })
    try {
      const target = this.#target(request.scope.targets)
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.#timeoutMs)])
      const health = await fetch(new URL("/health", target), { redirect: "error", signal })
      if (!health.ok) throw new Error(`lab health endpoint returned HTTP ${health.status}`)
      const healthJSON = (await health.json()) as unknown
      if (!healthJSON || typeof healthJSON !== "object" || (healthJSON as { status?: unknown }).status !== "ok") {
        throw new Error("lab health endpoint returned an invalid response")
      }
      const response = await fetch(new URL("/api/lab", target), { redirect: "error", signal })
      if (!response.ok) throw new Error(`lab endpoint returned HTTP ${response.status}`)
      const text = await response.text()
      if (text.length > 1_000_000) throw new Error("lab response exceeded the 1 MB artifact limit")
      const payload = JSON.parse(text) as LabPayload
      if (typeof payload.lab !== "string" || !Array.isArray(payload.observations)) throw new Error("lab response did not match the expected schema")
      const relative = `lab/${request.executionID}.json`
      const directory = path.dirname(path.join(request.artifactDirectory, relative))
      mkdirSync(directory, { recursive: true })
      const targetFile = path.join(request.artifactDirectory, relative)
      const temporary = `${targetFile}.${crypto.randomUUID()}.tmp`
      writeFileSync(temporary, `${JSON.stringify({ ...payload, target: target.href, executionID: request.executionID }, null, 2)}\n`, { mode: 0o600 })
      renameSync(temporary, targetFile)
      const artifact: ArtifactRef = { path: relative, mediaType: "application/json" }
      if (controller.signal.aborted) throw new DOMException("lab execution interrupted", "AbortError")
      const observation: ExecutionObservation = { status: "succeeded", summary: `${payload.observations.length} synthetic lab observations`, artifactRefs: [artifact] }
      await this.#save(request.artifactDirectory, request.operationID, request.executionID, observation)
      return { receipt }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown lab failure"
      const status = controller.signal.aborted ? "interrupted" : "failed"
      const relative = `lab/${request.executionID}.failure.json`
      const targetFile = path.join(request.artifactDirectory, relative)
      mkdirSync(path.dirname(targetFile), { recursive: true })
      const temporary = `${targetFile}.${crypto.randomUUID()}.tmp`
      writeFileSync(temporary, `${JSON.stringify({ operationID: request.operationID, executionID: request.executionID, status, summary: message }, null, 2)}\n`, { mode: 0o600 })
      renameSync(temporary, targetFile)
      const observation: ExecutionObservation = { status, summary: message, artifactRefs: [{ path: relative, mediaType: "application/json" }] }
      await this.#save(request.artifactDirectory, request.operationID, request.executionID, observation)
      return { receipt }
    } finally {
      this.#controllers.delete(receipt)
    }
  }

  async inspect(receipt: string): Promise<ExecutionObservation> {
    const current = this.#observations.get(receipt)
    if (current) return current
    const parsed = this.#parseReceipt(receipt)
    if (!parsed) return { status: "unknown", artifactRefs: [], summary: "lab receipt is malformed" }
    const file = this.#receiptFile(parsed.directory, parsed.executionID)
    if (!existsSync(file)) return { status: "unknown", artifactRefs: [], summary: "lab receipt has no durable execution record" }
    const saved = JSON.parse(readFileSync(file, "utf8")) as { operationID?: string; executionID?: string; observation?: ExecutionObservation }
    if (saved.operationID !== parsed.operationID || saved.executionID !== parsed.executionID || !saved.observation) {
      return { status: "unknown", artifactRefs: [], summary: "lab receipt record failed identity validation" }
    }
    if (saved.observation.status === "running") {
      const artifact = path.join(parsed.directory, "lab", `${parsed.executionID}.json`)
      if (existsSync(artifact)) {
        const payload = JSON.parse(readFileSync(artifact, "utf8")) as LabPayload & { executionID?: string }
        if (payload.executionID === parsed.executionID) {
          const observation: ExecutionObservation = {
            status: "succeeded",
            summary: `${payload.observations.length} synthetic lab observations recovered from durable artifact`,
            artifactRefs: [{ path: `lab/${parsed.executionID}.json`, mediaType: "application/json" }],
          }
          await this.#save(parsed.directory, parsed.operationID, parsed.executionID, observation)
          return observation
        }
      }
      const failure = path.join(parsed.directory, "lab", `${parsed.executionID}.failure.json`)
      if (existsSync(failure)) {
        const detail = JSON.parse(readFileSync(failure, "utf8")) as { status?: string; summary?: string }
        if (detail.status === "failed" || detail.status === "interrupted") {
          const observation: ExecutionObservation = {
            status: detail.status,
            summary: detail.summary,
            artifactRefs: [{ path: `lab/${parsed.executionID}.failure.json`, mediaType: "application/json" }],
          }
          await this.#save(parsed.directory, parsed.operationID, parsed.executionID, observation)
          return observation
        }
      }
      return { status: "unknown", artifactRefs: [], summary: "adapter restarted while lab request was running; outcome is unknown" }
    }
    this.#observations.set(receipt, saved.observation)
    return saved.observation
  }

  async interrupt(receipt?: string, request?: LaunchRequest) {
    const key = receipt ?? (request ? `lab1:${Buffer.from(path.resolve(request.artifactDirectory)).toString("base64url")}:${request.operationID}:${request.executionID}` : undefined)
    if (!key) return
    const controller = this.#controllers.get(key)
    if (controller) controller.abort()
    const prior = this.#observations.get(key)
    if (prior?.status === "running") this.#observations.set(key, { ...prior, status: "interrupted" })
  }

  async recover(request: LaunchRequest, receipt?: string) {
    if (receipt) {
      const prior = await this.inspect(receipt)
      if (prior.status === "running" || prior.status === "succeeded") return { receipt }
      if (prior.status === "unknown") return undefined
    }
    return this.launch(request)
  }

  async #save(directory: string, operationID: string, executionID: string, observation: ExecutionObservation) {
    this.#observations.set(`lab1:${Buffer.from(path.resolve(directory)).toString("base64url")}:${operationID}:${executionID}`, observation)
    const target = this.#receiptFile(directory, executionID)
    mkdirSync(path.dirname(target), { recursive: true })
    const temporary = `${target}.${crypto.randomUUID()}.tmp`
    writeFileSync(temporary, `${JSON.stringify({ operationID, executionID, observation }, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, target)
  }

  #parseReceipt(receipt: string) {
    const match = receipt.match(/^lab1:([A-Za-z0-9_-]+):([a-z0-9_-]{1,80}):([A-Za-z0-9-]{36})$/)
    if (!match) return undefined
    const directory = path.resolve(Buffer.from(match[1]!, "base64url").toString())
    if (path.basename(path.dirname(directory)) !== "operations" || path.basename(directory) !== match[2]) return undefined
    return { directory, operationID: match[2]!, executionID: match[3]! }
  }

  #receiptFile(directory: string, executionID: string) {
    return path.join(directory, "lab", "receipts", `${executionID}.json`)
  }

  #target(targets: string[]) {
    if (targets.length !== 1) throw new Error("loopback lab requires exactly one scoped target")
    const target = new URL(targets[0]!)
    if (target.protocol !== "http:" || !LOOPBACK_NAMES.has(target.hostname) || target.username || target.password) {
      throw new Error("loopback lab accepts only credential-free HTTP targets on localhost, 127.0.0.1, or ::1")
    }
    if (target.pathname !== "/" || target.search || target.hash) throw new Error("loopback lab target must be an origin without path, query, or fragment")
    return target
  }
}
