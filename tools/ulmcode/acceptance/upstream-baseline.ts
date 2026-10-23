import { checkoutRoot, evidenceRoot } from "./paths"
import { mkdir } from "node:fs/promises"
import { parseArgs } from "node:util"

const args = parseArgs({ options: { checkout: { type: "string", default: checkoutRoot }, bun: { type: "string", default: process.execPath } } })
const run = `${evidenceRoot}/baseline-${new Date().toISOString().replace(/[:.]/g, "-")}`
await mkdir(`${run}/workspace/.ulmcode/operations`, { recursive: true })
await mkdir(`${run}/config`, { recursive: true })
const record: { at: string; name: string; result: unknown }[] = []
async function note(name: string, result: unknown) {
  record.push({ at: new Date().toISOString(), name, result })
  await Bun.write(`${run}/results.json`, JSON.stringify({ run, checkout: args.values.checkout, transport: "synthetic-loopback-openai-chat-not-subscription-proof", record }, null, 2) + "\n")
  console.log(name)
}
const env = Object.fromEntries(["PATH", "LANG", "LC_ALL", "TERM", "SYSTEMROOT", "WINDIR"].flatMap((name) => process.env[name] ? [[name, process.env[name]!]] : []))
Object.assign(env, {
  PATH: `${args.values.bun.slice(0, args.values.bun.lastIndexOf("/"))}:${process.env.PATH}`,
  XDG_CONFIG_HOME: `${run}/xdg-config`, XDG_DATA_HOME: `${run}/data`, XDG_STATE_HOME: `${run}/state`, XDG_CACHE_HOME: `${run}/cache`,
  OPENCODE_TEST_HOME: `${run}/home`, OPENCODE_CONFIG_DIR: `${run}/config`, OPENCODE_CONFIG: `${run}/config/opencode.json`,
  OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_FFF: "1",
})
await note("isolation", { envKeys: Object.keys(env), run })
for (const tail of [["--version"], ["--help"], ["debug", "paths"]]) {
  const command = [args.values.bun, `${args.values.checkout}/packages/cli/src/index.ts`, ...tail]
  const child = Bun.spawn(command, { cwd: `${args.values.checkout}/packages/cli`, env, stdout: "pipe", stderr: "pipe", timeout: 30_000 })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  await note(`cli ${tail.join(" ")}`, { command, code, stdout, stderr })
  if (code !== 0) process.exit(1)
}
const modelRequests: { at: string; path: string; userTexts: string[] }[] = []
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  if (!path.endsWith("/chat/completions")) return Response.json({ error: "Unexpected local fixture route" }, { status: 404 })
  const body = await request.json() as { messages: { role: string; content: string | { type: string; text?: string }[] }[] }
  const texts = body.messages.filter((message) => message.role === "user").map((message) => typeof message.content === "string" ? message.content : message.content.flatMap((part) => part.text ? [part.text] : []).join("\n"))
  modelRequests.push({ at: new Date().toISOString(), path, userTexts: texts })
  await Bun.write(`${run}/model-requests.json`, JSON.stringify(modelRequests, null, 2) + "\n")
  const last = texts.at(-1) ?? "fixture"
  if (last.includes("ACCEPTANCE_SLOW")) await Bun.sleep(3000)
  const id = `chatcmpl-${crypto.randomUUID()}`
  const chunk = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "acceptance-chat", choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  return new Response(chunk({ role: "assistant", content: `Synthetic local response ${last.slice(-80)}` }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
} })
await Bun.write(`${run}/config/opencode.json`, JSON.stringify({
  model: "acceptance/acceptance-chat", default_agent: "acceptance", update: "disable", share: "disabled", snapshots: false,
  providers: { acceptance: { package: "@opencode/ai/providers/openai/chat", settings: { baseURL: `http://127.0.0.1:${provider.port}/v1` }, models: { "acceptance-chat": { name: "Independent synthetic transport", capabilities: { tools: false, input: ["text"], output: ["text"] }, limit: { context: 32000, output: 1000 } } } } },
  agents: { acceptance: { mode: "primary", steps: 8, system: "This is an isolated synthetic acceptance session. Respond briefly. Do not call tools or external services." } },
}, null, 2) + "\n")
const portReservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reservation") })
const port = portReservation.port
portReservation.stop(true)
const origin = `http://127.0.0.1:${port}`
env.OPENCODE_PASSWORD = crypto.randomUUID()
const command = [args.values.bun, `${args.values.checkout}/packages/cli/src/index.ts`, "serve", "--hostname", "127.0.0.1", "--port", String(port)]
function spawnHost(suffix: string) {
  return Bun.spawn(command, { cwd: `${args.values.checkout}/packages/cli`, env, stdout: Bun.file(`${run}/server${suffix}.stdout.log`), stderr: Bun.file(`${run}/server${suffix}.stderr.log`) })
}
let child = spawnHost("")
async function stopHost(target: ReturnType<typeof spawnHost>) {
  target.kill("SIGTERM")
  const timer = setTimeout(() => target.kill("SIGKILL"), 5000)
  await target.exited
  clearTimeout(timer)
}
async function request(method: string, path: string, body?: object) {
  const response = await fetch(`${origin}${path}`, { method, headers: { authorization: `Basic ${btoa(`opencode:${env.OPENCODE_PASSWORD}`)}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  await note(`${method} ${path}`, { status: response.status, body: data })
  return { status: response.status, body: data }
}
async function ready() {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Host exited with ${child.exitCode}`)
    const ready = await fetch(`${origin}/api/info`, { headers: { authorization: `Basic ${btoa(`opencode:${env.OPENCODE_PASSWORD}`)}` }, signal: AbortSignal.timeout(1000) }).then((response) => response.ok).catch(() => false)
    if (ready) break
    await Bun.sleep(250)
  }
  await note("host command", { command, cwd: `${args.values.checkout}/packages/cli`, pid: child.pid, origin })
}
async function check(name: string, condition: boolean, evidence: unknown) {
  await note(`assert ${name}`, { passed: condition, evidence })
  if (!condition) throw new Error(name)
}
async function idle(session: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/session/${session}`, { headers: { authorization: `Basic ${btoa(`opencode:${env.OPENCODE_PASSWORD}`)}` }, signal: AbortSignal.timeout(2000) })
    const info = await response.json() as { data: { outcome?: string; time: { idle?: number } } }
    const active = await fetch(`${origin}/api/session/active`, { headers: { authorization: `Basic ${btoa(`opencode:${env.OPENCODE_PASSWORD}`)}` }, signal: AbortSignal.timeout(2000) }).then((response) => response.json()) as { data: Record<string, unknown> }
    if (info.data.time.idle && !active.data[session]) return info.data
    await Bun.sleep(100)
  }
  throw new Error(`Session ${session} did not settle`)
}
async function waitModel(text: string, count = 1) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (modelRequests.filter((item) => item.userTexts.at(-1) === text).length >= count) return
    await Bun.sleep(50)
  }
  throw new Error(`Fixture did not receive ${text}`)
}
try {
  await ready()
  await request("GET", "/api/info")
  const created = await request("POST", "/api/session", { title: "Independent baseline", model: { providerID: "acceptance", id: "acceptance-chat" }, agent: "acceptance", location: { directory: `${run}/workspace` } })
  if (created.status !== 200) throw new Error("Session creation failed")
  const session = created.body.data.id as string
  const firstID = `msg_acceptance_${crypto.randomUUID()}`
  await request("POST", `/api/session/${session}/prompt`, { id: firstID, text: "ACCEPTANCE_FIRST" })
  await waitModel("ACCEPTANCE_FIRST")
  await check("first response succeeds", (await idle(session)).outcome === "succeeded", await request("GET", `/api/session/${session}`))
  const firstMessages = await request("GET", `/api/session/${session}/message?order=asc&limit=100`)
  await check("one first visible user message", firstMessages.body.data.filter((item: { type: string }) => item.type === "user").length === 1, firstMessages)
  await request("GET", `/api/session/${session}/inbox`)
  const retry = await request("POST", `/api/session/${session}/prompt`, { id: firstID, text: "ACCEPTANCE_CHANGED_RETRY", delivery: "queue" })
  await check("upstream first admission wins changed retry", retry.status === 200 && JSON.stringify(retry.body).includes("ACCEPTANCE_FIRST") && !JSON.stringify(retry.body).includes("ACCEPTANCE_CHANGED_RETRY"), retry)
  await request("POST", `/api/session/${session}/prompt`, { id: `msg_acceptance_${crypto.randomUUID()}`, text: "ACCEPTANCE_SECOND" })
  await waitModel("ACCEPTANCE_SECOND")
  await check("second response succeeds", (await idle(session)).outcome === "succeeded", await request("GET", `/api/session/${session}`))
  const secondMessages = await request("GET", `/api/session/${session}/message?order=asc&limit=100`)
  await check("two visible users and exactly two model requests", secondMessages.body.data.filter((item: { type: string }) => item.type === "user").length === 2 && modelRequests.length === 2, { messages: secondMessages, modelRequests: modelRequests.length })
  const idleStop = await request("POST", `/api/session/${session}/interrupt`)
  await check("idle interruption no-op", idleStop.status === 200 && idleStop.body.interrupted === false, idleStop)
  const other = await request("POST", "/api/session", { model: { providerID: "acceptance", id: "acceptance-chat" }, agent: "acceptance", location: { directory: `${run}/workspace` } })
  const conflict = await request("POST", `/api/session/${other.body.data.id}/prompt`, { id: firstID, text: "ACCEPTANCE_CROSS_SESSION", resume: false })
  await check("cross-session message ID conflict", conflict.status === 409, conflict)
  await request("POST", `/api/session/${session}/prompt`, { text: "ACCEPTANCE_SLOW_STEERING" })
  await waitModel("ACCEPTANCE_SLOW_STEERING")
  await request("POST", `/api/session/${session}/prompt`, { text: "ACCEPTANCE_STEER" })
  await request("POST", `/api/session/${session}/prompt`, { text: "ACCEPTANCE_QUEUE", delivery: "queue" })
  const pending = await request("GET", `/api/session/${session}/inbox`)
  await check("busy steering and queue persisted", pending.body.data.length === 2, pending)
  await waitModel("ACCEPTANCE_QUEUE")
  await idle(session)
  const deliveryMessages = await request("GET", `/api/session/${session}/message?order=asc&limit=100`)
  const deliveryTexts = deliveryMessages.body.data.filter((item: { type: string }) => item.type === "user").map((item: { text: string }) => item.text)
  await check("steer precedes queued input", deliveryTexts.slice(-3).join("|") === "ACCEPTANCE_SLOW_STEERING|ACCEPTANCE_STEER|ACCEPTANCE_QUEUE", deliveryTexts)
  await request("POST", `/api/session/${session}/prompt`, { text: "ACCEPTANCE_SLOW_INTERRUPT" })
  await waitModel("ACCEPTANCE_SLOW_INTERRUPT")
  const activeStop = await request("POST", `/api/session/${session}/interrupt`)
  await check("active interruption stops drain", activeStop.status === 200 && activeStop.body.interrupted === true && (await idle(session)).outcome === "interrupted", activeStop)
  const admitID = `msg_acceptance_${crypto.randomUUID()}`
  await request("POST", `/api/session/${session}/prompt`, { id: admitID, text: "ACCEPTANCE_ADMIT_ONLY", resume: false })
  const admitted = await request("GET", `/api/session/${session}/inbox`)
  await check("admit-only remains pending", admitted.body.data.length === 1, admitted)
  await request("POST", `/api/session/${session}/prompt`, { id: admitID, text: "RETRY_IGNORED", resume: true })
  await waitModel("ACCEPTANCE_ADMIT_ONLY")
  await check("pending exact retry resumes", (await idle(session)).outcome === "succeeded", await request("GET", `/api/session/${session}/inbox`))
  const requestsBeforeRestart = modelRequests.length
  await stopHost(child)
  child = spawnHost("-restart")
  await ready()
  const afterRestart = await request("GET", `/api/session/${session}/message?order=asc&limit=100`)
  await Bun.sleep(500)
  await check("idle session persisted without provider replay", afterRestart.body.data.some((item: { text?: string }) => item.text === "ACCEPTANCE_ADMIT_ONLY") && requestsBeforeRestart === modelRequests.length, { modelRequestsBefore: requestsBeforeRestart, modelRequestsAfter: modelRequests.length })
  await request("POST", `/api/session/${session}/prompt`, { text: "ACCEPTANCE_SLOW_CRASH" })
  await waitModel("ACCEPTANCE_SLOW_CRASH")
  child.kill("SIGKILL")
  await child.exited
  child = spawnHost("-crash-recovery")
  await ready()
  await Bun.sleep(500)
  await check("unregistered server does not sweep orphan claims", modelRequests.filter((item) => item.userTexts.at(-1) === "ACCEPTANCE_SLOW_CRASH").length === 1, { note: "Official automatic recovery is installed by managed service lifecycle only; standalone server intentionally does not sweep" })
  await request("POST", `/api/session/${session}/synthetic`, { text: "ACCEPTANCE_RECOVER_AFTER_CRASH", description: "Independent explicit restart continuation" })
  await waitModel("ACCEPTANCE_RECOVER_AFTER_CRASH")
  await check("explicit continuation succeeds after process death", (await idle(session)).outcome === "succeeded", await request("GET", `/api/session/${session}`))
  await note("model request count", { count: modelRequests.length })
  await note("baseline result", { accepted: true, note: "Synthetic model transport; no subscription authentication or desktop claim" })
} catch (error) {
  await note("baseline result", { accepted: false, error: String(error) })
  process.exitCode = 1
} finally {
  await stopHost(child)
  provider.stop(true)
  await note("cleanup", { trackedHostPID: child.pid, exitCode: child.exitCode, providerStopped: true })
}
