import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, readdir, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { startServer } from "../src/server"
import { startFakeLab } from "../src/fake-lab"
import type { OperationRecord, SchedulerDecision } from "../src/operation"

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const close of cleanup.reverse()) await close()
  cleanup.length = 0
})

test("HTTP host drives approved local evidence collection and refuses premature completion", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ulm-http-"))
  cleanup.push(() => rm(workspaceRoot, { recursive: true, force: true }))
  const lab = startFakeLab({ port: 0 })
  cleanup.push(() => lab.stop(true))
  const host = startServer({ workspaceRoot, port: 0 })
  cleanup.push(() => host.close())
  const endpoint = new URL("/api/operations", host.server.url)
  const post = (url: URL, body: unknown) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
  const created = await post(endpoint, {
    id: "http-flow", sessionID: "synthetic-session", objective: "Collect real synthetic HTTP evidence",
    scope: { mode: "synthetic_lab", targets: [lab.url.origin] },
  })
  expect(created.status).toBe(201)
  const initial = await created.json() as { operation: OperationRecord }
  expect(initial.operation.status).toBe("draft")
  const action = (name: string) => new URL(`${endpoint.pathname}/http-flow/${name}`, endpoint)
  const unapproved = await (await post(action("run"), {})).json() as { decision: SchedulerDecision }
  expect(unapproved.decision.action).toBe("blocked")
  expect(unapproved.decision.operation.executions).toHaveLength(0)
  expect((await post(action("approve"), { approvedBy: "synthetic-operator" })).status).toBe(200)
  const first = await (await post(action("run"), {})).json() as { decision: SchedulerDecision }
  expect(first.decision.action).toBe("launch")
  const settled = await (await post(action("run"), {})).json() as { operation: OperationRecord }
  expect(settled.operation.plan?.phases[0]?.status).toBe("complete")
  await mkdir(path.join(host.store.directory("http-flow"), "evidence"), { recursive: true })
  await writeFile(path.join(host.store.directory("http-flow"), "evidence/operator-observation.json"), JSON.stringify({
    observations: [{ summary: "Synthetic operator evidence registration through the public host." }],
  }))
  const registered = await (await post(action("artifacts"), { artifacts: [{ path: "evidence/operator-observation.json", mediaType: "application/json" }] })).json() as { operation: OperationRecord }
  expect(registered.operation.artifacts.find((item) => item.path === "evidence/operator-observation.json")?.sha256).toHaveLength(64)
  const retried = await (await post(action("artifacts"), { artifacts: [{ path: "evidence/operator-observation.json", mediaType: "application/json" }] })).json() as { operation: OperationRecord }
  expect(retried.operation.revision).toBe(registered.operation.revision)
  expect((await post(action("artifacts"), { artifacts: [{ path: "operation.db" }] })).status).toBe(400)
  const normalized = await (await post(action("normalize"), {})).json() as { operation: OperationRecord }
  expect(normalized.operation.evidence?.claims.length).toBeGreaterThan(0)
  const finding = {
    id: "synthetic-finding", title: "Explicit synthetic test finding", state: "candidate", severity: "informational",
    description: "This observation belongs only to the synthetic local host test and is not a real vulnerability.",
    affectedAssets: [lab.url.origin], evidenceIDs: [normalized.operation.evidence!.claims[0]!.id],
  }
  expect((await post(action("findings"), { findings: [finding] })).status).toBe(200)
  expect((await post(action("findings"), { findings: [{ ...finding, state: "validated" }] })).status).toBe(400)
  expect((await post(action("findings"), {
    reviewedBy: "synthetic-reviewer", findings: [{ ...finding, state: "validated", validationRationale: "The cited synthetic observation was reproduced against the local lab." }],
  })).status).toBe(200)
  const premature = await (await post(action("review-goal"), { verdict: "done" })).json() as { operation: OperationRecord }
  expect(premature.operation.goal.status).toBe("active")
  expect(premature.operation.goal.completion?.blockers.length).toBeGreaterThan(0)
  const artifact = normalized.operation.evidence!.artifacts[0]!
  const evidence = await fetch(new URL(`${endpoint.pathname}/http-flow/artifacts/${artifact.path}`, endpoint))
  expect(evidence.status).toBe(200)
  expect(await evidence.text()).toContain("synthetic")
  const missing = await fetch(new URL("/api/operations/missing", endpoint))
  expect(missing.status).toBe(404)
  expect(await readdir(path.join(workspaceRoot, ".ulmcode/operations"))).not.toContain("missing")
})

test("HTTP host enforces request shape, origin and registered artifact boundaries", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ulm-http-boundaries-"))
  cleanup.push(() => rm(workspaceRoot, { recursive: true, force: true }))
  const host = startServer({ workspaceRoot, port: 0 })
  cleanup.push(() => host.close())
  const url = new URL("/api/operations", host.server.url)
  expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(415)
  expect((await fetch(url, { headers: { Origin: "https://unrelated.example" } })).status).toBe(403)
  expect((await fetch(url, { headers: { Origin: "http://localhost:4444" } })).headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:4444")
  const desktop = await fetch(url, { method: "OPTIONS", headers: { Origin: "oc://renderer", "Access-Control-Request-Method": "POST" } })
  expect(desktop.status).toBe(204)
  expect(desktop.headers.get("Access-Control-Allow-Origin")).toBe("oc://renderer")
  expect((await fetch(url, { headers: { Origin: "oc://extensions" } })).status).toBe(403)
  expect((await fetch(url, { headers: { Origin: "null" } })).status).toBe(403)
  expect((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status).toBe(400)
  expect((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: "invalid" }) })).status).toBe(400)
  const denied = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      id: "unauthorized", sessionID: "synthetic", objective: "Refuse unsupported execution",
      scope: { mode: "authorized", authorizationRef: "synthetic-handle", targets: ["https://example.invalid"] },
    }),
  })
  expect(denied.status).toBe(400)
  expect(await host.store.list()).toHaveLength(0)
})

test("mounted vault submits privately and exposes reviewed handles to the operations UI", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ulm-http-vault-"))
  cleanup.push(() => rm(workspaceRoot, { recursive: true, force: true }))
  const host = startServer({ workspaceRoot, port: 0, credentialsDir: path.join(workspaceRoot, "private", "credentials") })
  cleanup.push(() => host.close())
  await host.engine.create({
    id: "vault-flow", sessionID: "console:vault-flow", objective: "Verify private credential submission",
    scope: { mode: "synthetic_lab", targets: ["http://127.0.0.1:4320"] },
  })
  const url = new URL("/api/operations/vault-flow/vault", host.server.url)
  const page = await fetch(url)
  expect(page.status).toBe(200)
  const form = await page.text()
  const token = /name="token" value="([^"]+)"/.exec(form)?.[1]
  expect(Boolean(token)).toBe(true)
  const value = `synthetic-${crypto.randomUUID()}`
  const body = new URLSearchParams({ token: token!, username: value, password: value, notes: value,
    reviewedBy: "synthetic-reviewer", authorize: "yes", authorizedTarget: "http://127.0.0.1:4320" })
  const submit = await fetch(new URL(`${url.pathname}/submit`, url), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: url.origin, Accept: "application/json" }, body,
  })
  expect(submit.status).toBe(201)
  const result = await submit.text()
  expect(result.includes(value)).toBe(false)
  const metadata = await fetch(new URL("/api/operations/vault-flow/credentials", url))
  const publicResult = await metadata.text()
  expect(publicResult.includes(value)).toBe(false)
  expect(JSON.parse(publicResult).reviewStatus).toEqual({ submitted: true, reviewed: 1, pending: 0, requiresReauth: 0 })
  const replay = await fetch(new URL(`${url.pathname}/submit`, url), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: url.origin, Accept: "application/json" }, body,
  })
  expect(replay.status).toBe(403)
})
