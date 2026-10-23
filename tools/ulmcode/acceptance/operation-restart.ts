import { mkdir } from "node:fs/promises"
import { checkoutRoot, evidenceRoot } from "./paths"

const run = `${evidenceRoot}/restart-${new Date().toISOString().replace(/[:.]/g, "-")}`
await mkdir(`${run}/workspace/.ulmcode/operations`, { recursive: true })
const results: { name: string; passed: boolean; detail?: unknown }[] = []
async function check(name: string, passed: boolean, detail?: unknown) { results.push({ name, passed, detail }); console.log(`${name}: ${passed ? "PASS" : "FAIL"}`); await Bun.write(`${run}/results.json`, JSON.stringify({ run, results }, null, 2) + "\n"); if (!passed) throw new Error(name) }
let delay = 0
let calls = 0
let malformed = false
const lab = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const pathname = new URL(request.url).pathname
  if (pathname === "/health") return Response.json({ status: "ok", synthetic: true })
  if (pathname !== "/api/lab") return new Response("Fixture not found", { status: 404 })
  calls++
  await Bun.sleep(delay)
  return malformed ? new Response("{malformed synthetic JSON") : Response.json({ lab: "Independent restart fixture", observations: [{ kind: "informational", summary: "Actual local response for restart reconciliation" }] })
} })
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reservation") })
const port = reservation.port
reservation.stop(true)
const origin = `http://127.0.0.1:${port}`
const command = [process.execPath, `${checkoutRoot}/packages/ulm/src/cli.ts`, "serve", "--workspace", `${run}/workspace`, "--port", String(port)]
function spawnHost(suffix: string) { return Bun.spawn(command, { cwd: checkoutRoot, stdout: Bun.file(`${run}/host${suffix}.stdout.log`), stderr: Bun.file(`${run}/host${suffix}.stderr.log`) }) }
let child = spawnHost("")
async function stopHost(target: ReturnType<typeof spawnHost>) { target.kill("SIGTERM"); const timer = setTimeout(() => target.kill("SIGKILL"), 5000); await target.exited; clearTimeout(timer) }
async function ready() { for (let attempt = 0; attempt < 80; attempt++) { if (child.exitCode !== null) throw new Error(`Host exited ${child.exitCode}`); if (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) }).then((response) => response.ok).catch(() => false)) return; await Bun.sleep(100) } throw new Error("Host never ready") }
async function api(method: string, path: string, body?: object) { const response = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) }); return { status: response.status, body: await response.json() } }
async function create(id: string) { await api("POST", "/api/operations", { id, sessionID: `session-${id}`, objective: "Independently verify interruption and durable receipt reconciliation", scope: { targets: [`http://127.0.0.1:${lab.port}`], mode: "synthetic_lab" } }); await api("POST", `/api/operations/${id}/approve`, { approvedBy: "independent-operator" }) }
async function waitCalls(expected: number) { for (let attempt = 0; attempt < 100; attempt++) { if (calls >= expected) return; await Bun.sleep(20) } throw new Error("Local request did not start") }
try {
  await ready()
  await create("receipt-restart")
  const launch = await api("POST", "/api/operations/receipt-restart/run", {})
  await check("real launch receipt recorded before restart", launch.status === 200 && Boolean(launch.body.operation.executions[0].receipt) && calls === 1)
  await stopHost(child)
  child = spawnHost("-receipt-restart")
  await ready()
  const reconciled = await api("POST", "/api/operations/receipt-restart/run", {})
  await check("fresh process imports durable success without duplicate request", reconciled.body.operation.executions[0].status === "succeeded" && calls === 1, { calls, executionStatus: reconciled.body.operation.executions[0].status })
  await create("interrupt-during-launch")
  delay = 700
  const pending = api("POST", "/api/operations/interrupt-during-launch/run", {})
  await waitCalls(2)
  const stopped = await api("POST", "/api/operations/interrupt-during-launch/interrupt", { reason: "Independent stop while the local request is active" })
  const raced = await pending
  const afterStop = await api("GET", "/api/operations/interrupt-during-launch")
  await check("operator stop survives in-flight launch completion", stopped.status === 200 && afterStop.body.operation.status === "interrupted", { runStatus: raced.status, operation: afterStop.body.operation })
  const recovered = await api("POST", "/api/operations/interrupt-during-launch/recover", {})
  await check("explicit recovery retries the interrupted safe phase with attempt accounting", calls === 3 && recovered.body.operation.executions[0].attempt === 2, { calls, recovery: recovered.body.recovery })
  await create("crash-during-launch")
  delay = 1500
  const abandoned = api("POST", "/api/operations/crash-during-launch/run", {}).catch(() => undefined)
  await waitCalls(4)
  child.kill("SIGKILL")
  await child.exited
  await abandoned
  child = spawnHost("-crash-restart")
  await ready()
  const recovery = await api("POST", "/api/operations/crash-during-launch/recover", {})
  const retry = await api("POST", "/api/operations/crash-during-launch/run", {})
  await check("unknown process-death outcome blocks unsafe replay", recovery.body.recovery.blockers.length > 0 && retry.body.decision.action === "blocked" && calls === 4, { calls, recovery: recovery.body.recovery, decision: retry.body.decision.action })
  delay = 0
  malformed = true
  await create("malformed-response")
  await api("POST", "/api/operations/malformed-response/run", {})
  const failed = await api("POST", "/api/operations/malformed-response/run", {})
  await check("malformed source failure remains durable artifact", failed.body.operation.executions[0].status === "failed" && failed.body.operation.executions[0].artifactRefs.length > 0, { operation: failed.body.operation })
} finally { await stopHost(child); lab.stop(true) }
