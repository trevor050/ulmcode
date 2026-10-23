import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { OperationEngine } from "../src/engine"
import { renderReport } from "../src/report"
import { OperationStore, OperationConflictError } from "../src/store"

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture(id: string) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ulm-findings-"))
  directories.push(workspaceRoot)
  const store = new OperationStore({ workspaceRoot })
  const engine = new OperationEngine({ store, workspaceRoot, adapter: {
    id: "test-no-dispatch",
    receipt: () => "receipt",
    launch: async () => ({ receipt: "receipt" }),
    inspect: async () => ({ status: "unknown", artifactRefs: [] }),
    interrupt: async () => undefined,
    recover: async () => undefined,
  } })
  const operation = await engine.create({
    id,
    sessionID: `session-${id}`,
    objective: "Validate one synthetic finding from source evidence.",
    scope: { targets: ["http://127.0.0.1:4320"], mode: "synthetic_lab" },
  })
  return { workspaceRoot, store, engine, operation }
}

const baseFinding = {
  id: "F-SYNTH-1",
  title: "Synthetic response header gap",
  state: "candidate" as const,
  severity: "medium" as const,
  description: "The synthetic response omitted an expected security header.",
  impact: "Browser protections may be weaker than the documented baseline.",
  remediation: "Set the missing response header at the application edge.",
  affectedAssets: ["http://127.0.0.1:4320"],
  evidenceIDs: [] as string[],
}

describe("operation artifact and finding registration", () => {
  test("registers immutable evidence by hash and exact retry does not revise the operation", async () => {
    const { store, engine, operation } = await fixture("artifact-register")
    const sourcePath = path.join(store.directory(operation.id), "evidence/source.json")
    await Bun.write(sourcePath, JSON.stringify({ observations: [{ kind: "configuration", summary: "The synthetic response omitted a CSP header." }] }) + "\n")
    const registered = await engine.recordArtifacts(operation.id, [{ path: "evidence/source.json", mediaType: "application/json" }])
    expect(registered.artifacts.find((item) => item.path === "evidence/source.json")?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect((await engine.recordArtifacts(operation.id, [{ path: "evidence/source.json", mediaType: "application/json" }])).revision).toBe(registered.revision)
    await Bun.write(sourcePath, "changed source bytes\n")
    await expect(engine.recordArtifacts(operation.id, [{ path: "evidence/source.json", mediaType: "application/json" }])).rejects.toBeInstanceOf(OperationConflictError)
    await expect(engine.recordArtifacts(operation.id, [{ path: "findings/findings.json", mediaType: "application/json" }])).rejects.toThrow("dedicated engine methods")
    await expect(engine.recordArtifacts(operation.id, [{ path: "evidence/../findings/findings.json", mediaType: "application/json" }])).rejects.toThrow("normalized relative paths")
    expect((await store.get(operation.id))?.revision).toBe(registered.revision)
    await store.close()
  })

  test("keeps candidates unpromoted and requires explicit evidence-backed review", async () => {
    const { store, engine, operation } = await fixture("findings-register")
    const sourcePath = path.join(store.directory(operation.id), "lab/source.json")
    await Bun.write(sourcePath, JSON.stringify({
      lab: "synthetic fixture",
      observations: [{ kind: "configuration", subject: "fixture", summary: "The synthetic response omitted a CSP header." }],
    }) + "\n")
    await engine.recordArtifacts(operation.id, [{ path: "lab/source.json", mediaType: "application/json" }])
    const normalized = await engine.normalizeEvidence(operation.id)
    const evidenceID = normalized.evidence?.claims[0]?.id
    if (!evidenceID) throw new Error("expected one normalized synthetic evidence claim")

    const candidate = await engine.recordFindings(operation.id, { findings: [baseFinding] })
    const candidateRevision = candidate.revision
    const candidateDocument = JSON.parse(await readFile(path.join(store.directory(operation.id), "findings/findings.json"), "utf8")) as {
      operationID: string
      findings: Array<{ id: string; state: string; reviewedBy?: string }>
    }
    expect(candidateDocument.operationID).toBe(operation.id)
    expect(candidateDocument.findings[0]).toMatchObject({ id: baseFinding.id, state: "candidate" })
    expect(candidateDocument.findings[0]?.reviewedBy).toBeUndefined()
    await expect(engine.recordFindings(operation.id, { findings: [] })).rejects.toThrow("must remain in canonical history")
    expect((await engine.recordFindings(operation.id, { findings: [baseFinding] })).revision).toBe(candidateRevision)
    expect(JSON.parse(await readFile(path.join(store.directory(operation.id), "findings/findings.json"), "utf8")).findings).toHaveLength(1)

    const completedRecord = {
      ...candidate,
      revision: candidate.revision + 1,
      status: "completed" as const,
      goal: { ...candidate.goal, status: "complete" as const, completion: { checkedAt: new Date().toISOString(), blockers: [] } },
      reportSourceRevision: candidate.revision,
      reportSourceDigest: "a".repeat(64),
      audit: { status: "passed" as const, checkedAt: new Date().toISOString(), blockers: [], recordRevision: candidate.revision + 1 },
    }
    await store.commit({
      operationID: operation.id,
      expectedRevision: candidate.revision,
      type: "test.completed",
      idempotencyKey: "test.completed",
      actor: { kind: "engine" },
      data: {},
      operation: completedRecord,
    })

    await expect(engine.recordFindings(operation.id, {
      findings: [{ ...baseFinding, state: "report_ready", evidenceIDs: [evidenceID], validationRationale: "Verified against the raw synthetic response." }],
    })).rejects.toThrow("reviewedBy")
    await expect(engine.recordFindings(operation.id, {
      reviewedBy: "synthetic-operator",
      findings: [{ ...baseFinding, state: "report_ready", evidenceIDs: ["missing-evidence"], validationRationale: "Verified against the raw synthetic response." }],
    })).rejects.toThrow("unknown evidence ID")

    const reportReady = await engine.recordFindings(operation.id, {
      reviewedBy: "synthetic-operator",
      findings: [{ ...baseFinding, state: "report_ready", evidenceIDs: [evidenceID], validationRationale: "Verified against the raw synthetic response." }],
    })
    expect(reportReady.revision).toBe(candidateRevision + 2)
    expect(reportReady.goal.status).toBe("active")
    expect(reportReady.status).toBe("blocked")
    expect(reportReady.audit?.status).toBe("blocked")
    expect(reportReady.artifacts.find((item) => item.path === "findings/findings.json")?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(reportReady.reportSourceDigest).toBeUndefined()
    const document = JSON.parse(await readFile(path.join(store.directory(operation.id), "findings/findings.json"), "utf8")) as {
      findings: Array<{ state: string; reviewedBy?: string; validationRationale?: string; evidenceIDs: string[] }>
    }
    expect(document.findings[0]).toMatchObject({
      state: "report_ready",
      reviewedBy: "synthetic-operator",
      validationRationale: "Verified against the raw synthetic response.",
      evidenceIDs: [evidenceID],
    })
    const rendered = await renderReport({ operation: reportReady, operationDirectory: store.directory(operation.id) })
    expect(rendered.counts.findings).toBe(1)
    expect(rendered.sourceDigest).toBeTruthy()
    const rejected = await engine.recordFindings(operation.id, {
      reviewedBy: "synthetic-operator",
      findings: [{ ...baseFinding, state: "rejected", evidenceIDs: [evidenceID], validationRationale: "The response difference was not a vulnerability." }],
    })
    const retained = await engine.recordFindings(operation.id, { findings: [] })
    expect(retained.revision).toBe(rejected.revision)
    expect(JSON.parse(await readFile(path.join(store.directory(operation.id), "findings/findings.json"), "utf8")).findings[0]).toMatchObject({
      id: baseFinding.id,
      state: "rejected",
      reviewedBy: "synthetic-operator",
    })
    await store.close()
  })
})
