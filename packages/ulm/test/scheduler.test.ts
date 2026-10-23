import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { OperationEngine } from "../src/engine"
import { LoopbackLabAdapter } from "../src/lab"
import { lintReport, renderReport } from "../src/report"
import { OperationScheduler } from "../src/scheduler"
import { OperationConflictError, OperationStore } from "../src/store"
import type { ArtifactRef, OperationCreateInput } from "../src/operation"

const directories: string[] = []
const servers: Array<{ stop(force?: boolean): void }> = []

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ulm-scheduler-"))
  directories.push(root)
  return root
}

function operationInput(target: string, id = "scheduler-fixture", targetDurationMs?: number): OperationCreateInput {
  return {
    id,
    sessionID: `session-${id}`,
    objective: "Complete one authorized local synthetic phase and create its final report.",
    scope: { targets: [target], mode: "synthetic_lab" },
    plan: {
      assumptions: ["The target is an ephemeral loopback fixture owned by this test."],
      successCriteria: ["Persist the fixture observation and final report."],
      phases: [{
        id: "fixture-read",
        title: "Read synthetic fixture metadata",
        dependsOn: [],
        successCriteria: ["Record the fixture response as evidence."],
        restart: "safe",
        required: true,
        expectedArtifacts: ["lab/"],
      }],
      reporting: { required: true },
    },
    goal: targetDurationMs === undefined ? undefined : { targetDurationMs },
  }
}

function pdfFixture() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 49 >>\nstream\nBT /F1 12 Tf 20 80 Td (Synthetic scheduler report) Tj ET\nendstream",
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

describe("durable operation scheduler", () => {
  test("runs one exact operation through evidence normalization, report and completion", async () => {
    const root = await workspace()
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (request.url.endsWith("/health")) return Response.json({ status: "ok" })
        return Response.json({ lab: "scheduler synthetic fixture", observations: [{ kind: "configuration", subject: "fixture", summary: "Synthetic metadata was collected." }] })
      },
    })
    servers.push(server)
    const target = `http://127.0.0.1:${server.port}`
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(operationInput(target))
    await engine.approvePlan(created.id, { approvedBy: "scheduler-test-operator" })
    let reports = 0
    const scheduler = new OperationScheduler({
      engine,
      store,
      pollIntervalMs: 10,
      report: async ({ operation, operationDirectory }) => {
        reports++
        const rendered = await renderReport({ operation, operationDirectory })
        if (!rendered.pdfRendered) {
          const pdfPath = path.join(operationDirectory, "deliverables/final/report.pdf")
          await Bun.write(pdfPath, pdfFixture())
          const manifestPath = path.join(operationDirectory, "deliverables/final/manifest.json")
          const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>
          const paths = ["deliverables/final/report.html", "deliverables/final/report.pdf", "deliverables/final/runtime-summary.json"]
          const files = await Promise.all(paths.map(async (relative) => ({
            path: relative,
            sha256: createHash("sha256").update(await readFile(path.join(operationDirectory, relative))).digest("hex"),
          })))
          await Bun.write(manifestPath, `${JSON.stringify({ ...manifest, render: { html: "complete", pdf: "complete" }, files }, null, 2)}\n`)
        }
        const current = (await store.get(operation.id))!
        const refs: ArtifactRef[] = [
          "deliverables/final/report.html",
          "deliverables/final/report.pdf",
          "deliverables/final/manifest.json",
          "deliverables/final/runtime-summary.json",
        ].map((file) => ({ path: file }))
        await engine.recordReport(current.id, {
          sourceRevision: rendered.manifest.sourceRevision,
          sourceDigest: rendered.manifest.sourceDigest,
          artifacts: refs,
        })
      },
    })
    const result = await scheduler.run(created.id)
    expect(result.action).toBe("complete")
    expect(result.operation.goal.status).toBe("complete")
    expect(result.operation.evidence?.claims).toHaveLength(1)
    expect(reports).toBe(1)
    const schedulerState = JSON.parse(await readFile(path.join(store.directory(created.id), "runtime/scheduler.json"), "utf8")) as { status: string; operationID: string; heartbeatAt: string }
    expect(schedulerState.status).toBe("complete")
    expect(schedulerState.operationID).toBe(created.id)
    expect(Date.parse(schedulerState.heartbeatAt)).toBeGreaterThan(0)
    await Bun.write(path.join(store.directory(created.id), "deliverables/final/report.pdf"), "CORRUPTED AFTER SCHEDULER COMPLETION")
    const reconciled = await scheduler.run(created.id)
    expect(reconciled.action).toBe("complete")
    expect(reports).toBe(2)
    expect((await lintReport({ operation: reconciled.operation, operationDirectory: store.directory(created.id) })).ok).toBe(true)
    await store.close()
  })

  test("returns explicit expand without sleeping or manufacturing work", async () => {
    const root = await workspace()
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => request.url.endsWith("/health")
      ? Response.json({ status: "ok" })
      : Response.json({ lab: "scheduler synthetic fixture", observations: [{ kind: "configuration", subject: "fixture", summary: "Synthetic metadata was collected." }] }) })
    servers.push(server)
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(operationInput(`http://127.0.0.1:${server.port}`, "scheduler-expand", 60_000))
    await engine.approvePlan(created.id, { approvedBy: "scheduler-test-operator" })
    let reports = 0
    const scheduler = new OperationScheduler({ engine, store, report: async () => { reports++ } })
    const result = await scheduler.run(created.id)
    expect(result.action).toBe("expand")
    expect(result.operation.executions).toHaveLength(1)
    expect(result.operation.plan?.phases[0]?.status).toBe("complete")
    expect(reports).toBe(0)
    await store.close()
  })

  test("rejects overlapping ownership for the same operation", async () => {
    const root = await workspace()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    let finishRequest!: () => void
    const pendingResponse = new Promise<void>((resolve) => { finishRequest = resolve })
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
      if (request.url.endsWith("/health")) return Response.json({ status: "ok" })
      markStarted()
      await pendingResponse
      return Response.json({ lab: "scheduler synthetic fixture", observations: [{ kind: "configuration", subject: "fixture", summary: "Synthetic metadata was collected." }] })
    } })
    servers.push(server)
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(operationInput(`http://127.0.0.1:${server.port}`, "scheduler-lock", 60_000))
    await engine.approvePlan(created.id, { approvedBy: "scheduler-test-operator" })
    const scheduler = new OperationScheduler({ engine, store, report: async () => undefined })
    const first = scheduler.run(created.id)
    await started
    await expect(scheduler.run(created.id)).rejects.toBeInstanceOf(OperationConflictError)
    finishRequest()
    expect((await first).action).toBe("expand")
    await store.close()
  })

  test("recovers only a scheduler-owned signal interruption after reopening the store", async () => {
    const root = await workspace()
    let announceStarted!: () => void
    const started = new Promise<void>((resolve) => { announceStarted = resolve })
    let releaseFirst!: () => void
    const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve })
    let attempts = 0
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
      if (request.url.endsWith("/health")) return Response.json({ status: "ok" })
      attempts++
      if (attempts === 1) {
        announceStarted()
        await firstResponse
      }
      return Response.json({ lab: "scheduler synthetic fixture", observations: [{ kind: "configuration", summary: "Synthetic recovery observation." }] })
    } })
    servers.push(server)
    const target = `http://127.0.0.1:${server.port}`
    let store = new OperationStore({ workspaceRoot: root })
    let engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(operationInput(target, "scheduler-recovery", 60_000))
    await engine.approvePlan(created.id, { approvedBy: "scheduler-test-operator" })
    const controller = new AbortController()
    const scheduler = new OperationScheduler({ engine, store, report: async () => undefined })
    const stopped = scheduler.run(created.id, { signal: controller.signal })
    await started
    controller.abort()
    releaseFirst()
    const interrupted = await stopped
    expect(interrupted.action).toBe("interrupted")
    expect(interrupted.operation.status).toBe("interrupted")
    await store.close()

    store = new OperationStore({ workspaceRoot: root })
    engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const restartedScheduler = new OperationScheduler({ engine, store, report: async () => undefined })
    const resumed = await restartedScheduler.run(created.id, { resume: true })
    expect(resumed.action).toBe("expand")
    expect(resumed.operation.plan?.phases[0]?.status).toBe("complete")
    expect(attempts).toBe(2)
    await store.close()
  })

  test("does not treat an operator interruption as scheduler-owned recovery", async () => {
    const root = await workspace()
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => request.url.endsWith("/health")
      ? Response.json({ status: "ok" })
      : Response.json({ lab: "scheduler synthetic fixture", observations: [] }) })
    servers.push(server)
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(operationInput(`http://127.0.0.1:${server.port}`, "operator-interrupt"))
    const interrupted = await engine.interrupt(created.id, "operator requested pause")
    const scheduler = new OperationScheduler({ engine, store, report: async () => undefined })
    const result = await scheduler.run(created.id, { resume: true })
    expect(result.action).toBe("blocked")
    expect(result.operation.status).toBe("interrupted")
    expect(interrupted.status).toBe("interrupted")
    await store.close()
  })

  test("does not relabel an operator stop when shutdown arrives during report work", async () => {
    const root = await workspace()
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => request.url.endsWith("/health")
      ? Response.json({ status: "ok" })
      : Response.json({ lab: "scheduler synthetic fixture", observations: [{ kind: "configuration", summary: "Synthetic report-gate observation." }] }) })
    servers.push(server)
    const store = new OperationStore({ workspaceRoot: root })
    const engine = new OperationEngine({ store, workspaceRoot: root, adapter: new LoopbackLabAdapter() })
    const created = await engine.create(operationInput(`http://127.0.0.1:${server.port}`, "scheduler-operator-stop"))
    await engine.approvePlan(created.id, { approvedBy: "scheduler-test-operator" })
    let markReportStarted!: () => void
    const reportStarted = new Promise<void>((resolve) => { markReportStarted = resolve })
    let finishReport!: () => void
    const reportPending = new Promise<void>((resolve) => { finishReport = resolve })
    const controller = new AbortController()
    const scheduler = new OperationScheduler({
      engine,
      store,
      report: async () => {
        markReportStarted()
        await reportPending
      },
    })
    const stopped = scheduler.run(created.id, { signal: controller.signal })
    await reportStarted
    const operatorStop = await engine.interrupt(created.id, "operator chose to stop finalization")
    controller.abort()
    finishReport()
    const result = await stopped
    expect(result.action).toBe("interrupted")
    expect(operatorStop.lastError?.message).toBe("operator chose to stop finalization")
    const lastInterrupt = (await store.events(created.id)).filter((event) => event.type === "operation.interrupted").at(-1)
    expect(lastInterrupt?.data).toMatchObject({ source: "operator" })
    const restarted = await new OperationScheduler({ engine, store, report: async () => undefined }).run(created.id, { resume: true })
    expect(restarted.action).toBe("blocked")
    expect(restarted.operation.status).toBe("interrupted")
    await store.close()
  })
})
