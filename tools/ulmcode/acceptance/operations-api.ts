import { checkoutRoot, evidenceRoot, chromiumPath } from "./paths"
import { mkdir } from "node:fs/promises"

const checkout = checkoutRoot
const bun = process.execPath
const run = `${evidenceRoot}/operations-${new Date().toISOString().replace(/[:.]/g, "-")}`
await mkdir(`${run}/workspace/.ulmcode/operations`, { recursive: true })
const results: { name: string; passed?: boolean; evidence: unknown; at: string }[] = []
async function note(name: string, evidence: unknown, passed?: boolean) {
  results.push({ name, evidence, passed, at: new Date().toISOString() })
  await Bun.write(`${run}/results.json`, JSON.stringify({ checkout, run, transport: "public-local-operation-host-independent-target", results }, null, 2) + "\n")
  console.log(`${name}${passed === undefined ? "" : passed ? " PASS" : " FAIL"}`)
}
let calls = 0
const lab = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === "/health") return Response.json({ status: "ok", fixture: "independent-acceptance" })
  if (path === "/api/lab") {
    calls++
    return Response.json({ lab: "Independent synthetic lab", observations: [{ kind: "candidate", subject: "local diagnostic fixture", summary: "Unvalidated synthetic candidate; must not become a confirmed finding without validation.", confidence: 0.5 }] })
  }
  return new Response("Fixture route not found", { status: 404 })
} })
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reservation") })
const port = reservation.port
reservation.stop(true)
const origin = `http://127.0.0.1:${port}`
const command = [bun, `${checkout}/packages/ulm/src/cli.ts`, "serve", "--workspace", `${run}/workspace`, "--port", String(port), "--chromium", chromiumPath]
const child = Bun.spawn(command, { cwd: checkout, stdout: Bun.file(`${run}/host.stdout.log`), stderr: Bun.file(`${run}/host.stderr.log`) })
async function request(method: string, path: string, body?: object) {
  const response = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
  const text = await response.text()
  const value = text ? JSON.parse(text) : null
  await note(`${method} ${path}`, { status: response.status, body: value })
  return { status: response.status, body: value }
}
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Operation host exited ${child.exitCode}`)
    if (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) }).then((response) => response.ok).catch(() => false)) break
    await Bun.sleep(100)
  }
  await note("launch", { command, pid: child.pid, origin, lab: `http://127.0.0.1:${lab.port}` })
  await request("GET", "/health")
  const create = { id: "independent-flow", sessionID: "acceptance-session-a", objective: "Independently collect synthetic local observations and produce a source-backed final package", scope: { targets: [`http://127.0.0.1:${lab.port}`], mode: "synthetic_lab" } }
  const created = await request("POST", "/api/operations", create)
  await note("operation created", created, created.status === 201 && created.body.operation.goal.status === "active")
  const before = await request("POST", "/api/operations/independent-flow/run", {})
  await note("plan-first gate", before, before.body.decision.action === "blocked" && calls === 0)
  const early = await request("POST", "/api/operations/independent-flow/review-goal", { verdict: "done", reason: "Adversarial premature completion" })
  await note("YES cannot bypass missing artifacts", early, early.body.operation.goal.status === "active" && early.body.result.blockers.length > 0)
  const retry = await request("POST", "/api/operations", create)
  await note("public create exact retry reconciles", retry, retry.status === 200 || retry.status === 201)
  const bound = await request("POST", "/api/operations", { ...create, id: "binding-collision", objective: "Another operation must not steal same session" })
  await note("session cannot silently bind two operations", bound, bound.status === 409)
  const invalid = await request("POST", "/api/operations", { ...create, id: "../traversal", sessionID: "acceptance-invalid" })
  await note("operation ID traversal rejected", invalid, invalid.status >= 400)
  const approved = await request("POST", "/api/operations/independent-flow/approve", { approvedBy: "independent-acceptance-operator" })
  await note("explicit approval durable", approved, approved.status === 200 && Boolean(approved.body.operation.plan.approvedAt))
  const execution = await request("POST", "/api/operations/independent-flow/run", {})
  await note("real scoped local request", execution, calls === 1 && execution.body.operation.executions.length === 1)
  const reconcile = await request("POST", "/api/operations/independent-flow/run", {})
  await note("execution receipt reconciles", reconcile, reconcile.body.operation.executions[0].status === "succeeded" && calls === 1)
  const normalized = await request("POST", "/api/operations/independent-flow/normalize", {})
  const repeated = await request("POST", "/api/operations/independent-flow/normalize", {})
  await note("normalization stable claim identity", { first: normalized.body.operation.evidence, second: repeated.body.operation.evidence }, JSON.stringify(normalized.body.operation.evidence.claims.map((item: { id: string }) => item.id)) === JSON.stringify(repeated.body.operation.evidence.claims.map((item: { id: string }) => item.id)))
  const blocked = await request("POST", "/api/operations/independent-flow/review-goal", { verdict: "done", reason: "Adversarial no-render completion" })
  await note("normalized evidence cannot bypass final report", blocked, blocked.body.operation.goal.status === "active" && blocked.body.result.blockers.length > 0)
  const report = await request("POST", "/api/operations/independent-flow/report", {})
  await note("actual HTML/PDF report and deterministic completion", report, report.status === 200 && report.body.report?.pdfRendered === true && report.body.operation?.goal.status === "complete")
  const lint = await request("GET", "/api/operations/independent-flow/lint")
  await note("fresh report lint", lint, lint.status === 200 && lint.body.ok === true)
  const reopened = await request("POST", "/api/operations/independent-flow/normalize", {})
  const relint = await request("GET", "/api/operations/independent-flow/lint")
  await note("completed normalization preserves valid package or reopens goal", { normalize: reopened, lint: relint }, reopened.status >= 400 || reopened.body.operation.goal.status !== "complete" || relint.body.ok === true)
  await note("lab request count", { calls }, calls === 1)
  await request("GET", "/api/operations/independent-flow/events")
  await note("summary", { failures: results.filter((item) => item.passed === false).map((item) => item.name), finalDirectory: `${run}/workspace/.ulmcode/operations/independent-flow/deliverables/final` })
  if (results.some((item) => item.passed === false)) process.exitCode = 1
} catch (error) {
  await note("runner error", { message: String(error) }, false)
  process.exitCode = 1
} finally {
  child.kill("SIGTERM")
  await Promise.race([child.exited, Bun.sleep(5000).then(() => child.kill("SIGKILL"))])
  lab.stop(true)
  await note("cleanup", { trackedPID: child.pid, exitCode: child.exitCode })
}
