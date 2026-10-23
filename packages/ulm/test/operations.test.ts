import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { OperationEngine } from "../src/engine"
import { operationSourceDigest, type ArtifactRef, type OperationCreateInput, type OperationRecord } from "../src/operation"
import { applyCompletionGate } from "../src/goal"
import { LoopbackLabAdapter } from "../src/lab"
import { lintReport, renderReport } from "../src/report"
import { OperationConflictError, OperationStore } from "../src/store"

const directories: string[] = []
const servers: Array<{ stop(force?: boolean): void }> = []

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ulm-operation-"))
  directories.push(root)
  return root
}

function labServer(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

function createInput(target: string, id = "synthetic-run", sessionID = "session-a"): OperationCreateInput {
  return {
    id,
    sessionID,
    objective: "Collect evidence from the local synthetic lab",
    scope: { targets: [target], mode: "synthetic_lab" },
    plan: {
      assumptions: ["The target is a local fixture owned by this test."],
      successCriteria: ["Record a synthetic observation and normalize its source."],
      phases: [{
        id: "local-observation",
        title: "Read local lab metadata",
        dependsOn: [],
        successCriteria: ["The lab returns a structured observation."],
        restart: "safe",
        required: true,
        expectedArtifacts: ["lab/"],
      }],
      reporting: { required: true },
    },
  }
}

function successResponse() {
  return Response.json({
    lab: "synthetic acceptance fixture",
    observations: [
      { kind: "configuration", subject: "fixture-web", summary: "Synthetic response omits a Content-Security-Policy header.", confidence: 0.99 },
    ],
  })
}

async function completeReport(engine: OperationEngine, store: OperationStore, operation: OperationRecord) {
  const current = (await store.get(operation.id))!
  const directory = store.directory(current.id)
  const finalDirectory = path.join(directory, "deliverables", "final")
  await mkdir(finalDirectory, { recursive: true })
  const rendered = await renderReport({ operation: current, operationDirectory: directory })
  if (!rendered.pdfRendered) await Bun.write(path.join(finalDirectory, "report.pdf"), minimalPDF())
  const sourceRevision = rendered.manifest.sourceRevision
  const sourceDigest = rendered.manifest.sourceDigest
  const manifestDocument = JSON.parse(await readFile(path.join(finalDirectory, "manifest.json"), "utf8")) as Record<string, unknown>
  const paths = [
    "deliverables/final/report.html",
    "deliverables/final/report.pdf",
    "deliverables/final/runtime-summary.json",
  ]
  const files = await Promise.all(paths.map(async (relative) => ({
    path: relative,
    sha256: createHash("sha256").update(await readFile(path.join(directory, relative))).digest("hex"),
  })))
  await Bun.write(path.join(finalDirectory, "manifest.json"), JSON.stringify({ ...manifestDocument, ...rendered.manifest, files }) + "\n")
  const artifacts: ArtifactRef[] = [
    ...paths,
    "deliverables/final/manifest.json",
  ].map((relative) => ({ path: relative, mediaType: relative.endsWith(".pdf") ? "application/pdf" : "application/json" }))
  return engine.recordReport(current.id, { sourceRevision, sourceDigest, artifacts })
}

async function registerHashOnlyReport(engine: OperationEngine, store: OperationStore, operation: OperationRecord) {
  const directory = store.directory(operation.id)
  const finalDirectory = path.join(directory, "deliverables", "final")
  await mkdir(finalDirectory, { recursive: true })
  await Bun.write(path.join(finalDirectory, "report.html"), "NOT A REAL REPORT")
  await Bun.write(path.join(finalDirectory, "report.pdf"), "NOT A REAL REPORT")
  await Bun.write(path.join(finalDirectory, "runtime-summary.json"), "{}\n")
  const sourceRevision = operation.revision
  const sourceDigest = operationSourceDigest(operation)
  const paths = [
    "deliverables/final/report.html",
    "deliverables/final/report.pdf",
    "deliverables/final/runtime-summary.json",
  ]
  const files = await Promise.all(paths.map(async (relative) => ({
    path: relative,
    sha256: createHash("sha256").update(await readFile(path.join(directory, relative))).digest("hex"),
  })))
  await Bun.write(path.join(finalDirectory, "manifest.json"), JSON.stringify({
    operationID: operation.id,
    sourceRevision,
    sourceDigest,
    generatedAt: new Date().toISOString(),
    render: { html: "complete", pdf: "complete" },
    files,
  }) + "\n")
  const artifacts: ArtifactRef[] = [...paths, "deliverables/final/manifest.json"].map((relative) => ({
    path: relative,
    mediaType: relative.endsWith(".pdf") ? "application/pdf" : relative.endsWith(".html") ? "text/html" : "application/json",
  }))
  return engine.recordReport(operation.id, { sourceRevision, sourceDigest, artifacts })
}

function minimalPDF() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 54 >>\nstream\nBT /F1 12 Tf 20 80 Td (Synthetic report fixture) Tj ET\nendstream",
  ]
  let output = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${body}\nendobj\n`
  }
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("")
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return output
}

describe("durable operation engine", () => {
  test("successful completion clears a resolved operation error", async () => {
    const root = await workspace()
    const target = labServer(() => Response.json({ status: "ok" }))
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(createInput(target, "clear-error-run"))
    const errored: OperationRecord = {
      ...created,
      status: "blocked",
      lastError: { code: "interrupted", message: "resolved by the operator", at: created.updatedAt },
    }
    expect(applyCompletionGate(errored, []).operation.lastError).toBeUndefined()
    await store.close()
  })

  test("persists intent and evidence through a fresh store, then completes only after report gates", async () => {
    const root = await workspace()
    const target = labServer((request) => request.url.endsWith("/health")
      ? Response.json({ status: "ok" })
      : request.url.endsWith("/api/lab") ? successResponse() : new Response("not found", { status: 404 }))
    let store = new OperationStore({ workspaceRoot: root })
    let engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(createInput(target))
    expect((await engine.create(createInput(target))).revision).toBe(created.revision)
    await engine.approvePlan(created.id, { approvedBy: "test-operator" })
    const launched = await engine.tick(created.id)
    expect(launched.action).toBe("launch")
    if (launched.action !== "launch") throw new Error("expected an adapter launch")
    expect(launched.operation.executions[0]?.receipt).toContain("lab1:")

    const operationDirectory = store.directory(created.id)
    const database = new Database(path.join(operationDirectory, "operation.db"))
    database.query("DELETE FROM operation_snapshot WHERE id = ?").run(created.id)
    database.close()
    await rm(path.join(operationDirectory, "operation.json"))
    await store.close()

    store = new OperationStore({ workspaceRoot: root })
    engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const recoveredTick = await engine.tick(created.id)
    expect(recoveredTick.action).toBe("blocked")
    const completedPhase = await store.get(created.id)
    expect(completedPhase?.plan?.phases[0]?.status).toBe("complete")
    expect(await Bun.file(path.join(operationDirectory, "operation.json")).exists()).toBe(true)
    expect((await store.events(created.id)).map((event) => event.type)).toContain("execution.succeeded")

    await engine.normalizeEvidence(created.id)
    const normalized = await engine.normalizeEvidence(created.id)
    expect(normalized.evidence?.claims[0]?.summary).toContain("Synthetic response")
    expect(normalized.evidence?.artifacts.some((artifact) => artifact.path === "evidence/normalized.json")).toBe(false)
    const hashOnly = await registerHashOnlyReport(engine, store, normalized)
    const rejected = await engine.evaluateCompletion(created.id)
    expect(rejected.completed).toBe(false)
    expect(rejected.blockers.some((blocker) => blocker.includes("report lint"))).toBe(true)
    const reportRegistered = await completeReport(engine, store, hashOnly)
    const completion = await engine.evaluateCompletion(created.id)
    expect(completion.completed).toBe(true)
    expect(completion.operation.goal.status).toBe("complete")
    expect(completion.operation.audit?.recordRevision).toBe(completion.operation.revision)
    expect(reportRegistered.reportSourceDigest).toBe(operationSourceDigest(reportRegistered))
    const unchangedNormalization = await engine.normalizeEvidence(created.id)
    expect(unchangedNormalization.revision).toBe(completion.operation.revision)
    await Bun.write(path.join(operationDirectory, "deliverables/final/report.pdf"), "CORRUPTED AFTER COMPLETION")
    const integrityFailure = await engine.tick(created.id)
    expect(integrityFailure.action).toBe("blocked")
    expect(integrityFailure.operation.goal.status).toBe("active")
    expect(integrityFailure.operation.audit?.status).toBe("blocked")
    await completeReport(engine, store, integrityFailure.operation)
    expect((await engine.evaluateCompletion(created.id)).completed).toBe(true)
    const source = normalized.evidence?.artifacts.find((artifact) => artifact.path.startsWith("lab/"))
    if (!source) throw new Error("expected a durable lab artifact")
    const sourceFile = path.join(operationDirectory, source.path)
    const originalSource = await readFile(sourceFile)
    const revisedSource = JSON.stringify({
      lab: "synthetic acceptance fixture",
      observations: [{ kind: "configuration", summary: "Synthetic observation was substantively updated." }],
    }) + "\n"
    await Bun.write(sourceFile, revisedSource)
    await expect(engine.normalizeEvidence(created.id)).rejects.toThrow("registered evidence source changed")
    await Bun.write(sourceFile, originalSource)
    await Bun.write(path.join(operationDirectory, "lab/manual-revision.json"), revisedSource)
    await engine.recordArtifacts(created.id, [{ path: "lab/manual-revision.json", mediaType: "application/json" }])
    const changed = await engine.normalizeEvidence(created.id)
    expect(changed.goal.status).toBe("active")
    expect(changed.status).toBe("blocked")
    expect(changed.audit?.status).toBe("blocked")
    expect(changed.reportSourceDigest).toBeUndefined()
    expect((await lintReport({ operation: changed, operationDirectory })).ok).toBe(false)
    await store.close()
  })

  test("interrupts an in-flight loopback request and recovers only the safe phase", async () => {
    const root = await workspace()
    let announceStarted!: () => void
    const started = new Promise<void>((resolve) => { announceStarted = resolve })
    let releaseFirst!: () => void
    const firstResponse = new Promise<Response>((resolve) => { releaseFirst = () => resolve(successResponse()) })
    let attempts = 0
    const target = labServer(async (request) => {
      if (request.url.endsWith("/health")) return Response.json({ status: "ok" })
      attempts += 1
      if (attempts === 1) {
        announceStarted()
        return firstResponse
      }
      return successResponse()
    })
    const store = new OperationStore({ workspaceRoot: root })
    const adapter = new LoopbackLabAdapter()
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter })
    const created = await engine.create(createInput(target, "interrupt-run"))
    await engine.approvePlan(created.id, { approvedBy: "test-operator" })
    const pendingTick = engine.tick(created.id)
    await started
    const interrupted = await engine.interrupt(created.id, "operator requested stop")
    expect(interrupted.status).toBe("interrupted")
    expect((await engine.tick(created.id)).action).toBe("blocked")
    expect(attempts).toBe(1)
    releaseFirst()
    const launchResult = await pendingTick
    expect(launchResult.action).toBe("blocked")

    const recovered = await engine.recover(created.id)
    expect(recovered.blockers).toEqual([])
    expect(recovered.recovered).toHaveLength(1)
    const completed = await engine.tick(created.id)
    expect(completed.action).toBe("blocked")
    expect((await store.get(created.id))?.plan?.phases[0]?.status).toBe("complete")
    expect(attempts).toBe(2)
    await store.close()
  })

  test("writes and amends a plan on an existing draft while revoking approval", async () => {
    const root = await workspace()
    const target = labServer((request) => request.url.endsWith("/health")
      ? Response.json({ status: "ok" })
      : successResponse())
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const input = createInput(target, "plan-write-run")
    const { plan, ...withoutPlan } = input
    const created = await engine.create(withoutPlan)
    const written = await engine.setPlan(created.id, plan!)
    expect(written.plan?.version).toBe(1)
    expect((await engine.setPlan(created.id, plan!)).revision).toBe(written.revision)
    const approved = await engine.approvePlan(created.id, { approvedBy: "test-operator" })
    expect((await engine.approvePlan(created.id, { approvedBy: "test-operator" })).revision).toBe(approved.revision)
    const amended = await engine.setPlan(created.id, { ...plan!, assumptions: [...plan!.assumptions, "Amended after review."] })
    expect(amended.plan?.version).toBe(2)
    expect(amended.plan?.approvedAt).toBeUndefined()
    expect((await engine.tick(created.id)).action).toBe("blocked")
    await engine.approvePlan(created.id, { approvedBy: "test-operator" })
    expect((await engine.tick(created.id)).action).toBe("launch")
    await store.close()
  })

  test("persists approved command metadata without accepting secret-shaped variables", async () => {
    const root = await workspace()
    const target = labServer(() => Response.json({ status: "ok" }))
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const input = createInput(target, "command-plan-run")
    const phase = input.plan!.phases[0]!
    const { plan: initialPlan, ...withoutPlan } = input
    const created = await engine.create(withoutPlan)
    const command = {
      profileID: "bounded-http-check",
      variables: { target: "http://127.0.0.1:4320" },
      credentialHandles: ["cred_abc123"],
    }
    const plan = { ...initialPlan!, phases: [{ ...phase, command }] }
    const planned = await engine.setPlan(created.id, plan)
    expect(planned.plan?.phases[0]?.command).toEqual(command)
    expect(operationSourceDigest(planned)).not.toBe(operationSourceDigest(created))
    const approved = await engine.approvePlan(created.id, { approvedBy: "test-operator" })
    const unsupported = await engine.tick(created.id)
    expect(unsupported.action).toBe("blocked")
    if (unsupported.action !== "blocked") throw new Error("default lab adapter must reject command phases")
    expect(unsupported.blockers[0]).toContain("supervised command catalog")
    expect(unsupported.operation.executions).toHaveLength(0)
    const amended = await engine.setPlan(created.id, {
      ...plan,
      phases: [{ ...phase, command: { ...command, variables: { target: "http://127.0.0.1:4321" } } }],
    })
    expect(amended.plan?.approvedAt).toBeUndefined()
    expect(amended.plan?.version).toBe((approved.plan?.version ?? 0) + 1)
    await expect(engine.setPlan(created.id, {
      ...plan,
      phases: [{ ...phase, command: { ...command, variables: { api_token: "must-not-persist" } } }],
    })).rejects.toThrow("secret-shaped")
    await store.close()
  })

  test("records failed lab responses and refuses duplicate or cross-operation session binding", async () => {
    const root = await workspace()
    const target = labServer((request) => request.url.endsWith("/health")
      ? Response.json({ status: "ok" })
      : new Response("fixture unavailable", { status: 503 }))
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const first = await engine.create(createInput(target, "failure-run", "session-bound"))
    await engine.approvePlan(first.id, { approvedBy: "test-operator" })
    expect((await engine.tick(first.id)).action).toBe("launch")
    const failed = await engine.tick(first.id)
    expect(failed.action).toBe("blocked")
    const record = await store.get(first.id)
    expect(record?.executions[0]?.status).toBe("failed")
    expect(record?.executions[0]?.artifactRefs[0]?.path).toContain(".failure.json")
    const second = await engine.create(createInput(target, "second-run", "session-other"))
    await expect(store.bindSession(second.id, "session-bound")).rejects.toBeInstanceOf(OperationConflictError)
    expect((await store.forSession("session-bound"))?.id).toBe(first.id)
    await expect(engine.create(createInput(target, "failure-run", "session-new"))).rejects.toBeInstanceOf(OperationConflictError)
    expect(await stat(path.join(store.directory(first.id), "lab", `${record?.executions[0]?.id}.failure.json`))).toBeTruthy()
    await store.close()
  })

  test("rejects an invalid adapter scope before recording a launch intent", async () => {
    const root = await workspace()
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(createInput("https://example.invalid", "invalid-scope-run"))
    await engine.approvePlan(created.id, { approvedBy: "test-operator" })
    const result = await engine.tick(created.id)
    expect(result.action).toBe("blocked")
    if (result.action !== "blocked") throw new Error("invalid adapter scope must be blocked before dispatch")
    expect(result.blockers[0]).toContain("loopback")
    expect(result.operation.executions).toHaveLength(0)
    await store.close()
  })

  test("replays an event idempotently but rejects reused keys with a different command", async () => {
    const root = await workspace()
    const target = labServer(() => Response.json({ status: "ok" }))
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(createInput(target, "idempotency-run"))
    const review = await engine.reviewGoal(created.id, "continue", { idempotencyKey: "review-one", reason: "first review" })
    expect((await engine.reviewGoal(created.id, "continue", { idempotencyKey: "review-one", reason: "first review" })).operation.revision).toBe(review.operation.revision)
    await expect(engine.reviewGoal(created.id, "needs_operator", { idempotencyKey: "review-one", reason: "changed command" })).rejects.toBeInstanceOf(OperationConflictError)
    const original = (await store.get(created.id))!
    const approval = await engine.approvePlan(created.id, { approvedBy: "test-operator" })
    const replay = await store.commit({
      operationID: created.id,
      expectedRevision: original.revision,
      type: "plan.approved",
      idempotencyKey: "plan.approved:1:test-operator",
      actor: { kind: "operator", id: "test-operator" },
      data: { planVersion: 1, approvedAt: approval.plan?.approvedAt, approvedBy: "test-operator" },
      operation: { ...approval, revision: original.revision + 1 },
    })
    expect(replay.replayed).toBe(true)
    await expect(store.commit({
      operationID: created.id,
      expectedRevision: original.revision,
      type: "different.command",
      idempotencyKey: "plan.approved:1:test-operator",
      actor: { kind: "operator", id: "test-operator" },
      data: { planVersion: 1, approvedAt: approval.plan?.approvedAt, approvedBy: "test-operator" },
      operation: { ...approval, revision: original.revision + 1 },
    })).rejects.toBeInstanceOf(OperationConflictError)
    await store.close()
  })
})
