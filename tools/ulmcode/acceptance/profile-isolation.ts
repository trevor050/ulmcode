import { mkdir } from "node:fs/promises"
import path from "node:path"
import { checkoutRoot, evidenceRoot } from "./paths"

const run = `${evidenceRoot}/profile-isolation-${new Date().toISOString().replace(/[:.]/g, "-")}`
const workspace = `${run}/workspace`
const profile = `${run}/profile`
const poisonHome = `${run}/synthetic-home`
const marker = `acceptance-poison-${crypto.randomUUID()}`
const control = process.env.PROFILE_ISOLATION_CONTROL === "1"
await mkdir(`${workspace}/.ulmcode/operations`, { recursive: true })
await mkdir(`${poisonHome}/.agents/skills/${marker}`, { recursive: true })
await mkdir(`${profile}/config`, { recursive: true })
await Bun.write(`${poisonHome}/.agents/skills/${marker}/SKILL.md`, `---\nname: ${marker}\ndescription: Synthetic poison skill for isolation acceptance\n---\nThis synthetic skill must not load into the isolated ULM profile.\n`)
await Bun.write(`${profile}/config/AGENTS.md`, `Synthetic global instruction marker ${marker}\n`)
await Bun.write(`${workspace}/AGENTS.md`, `Synthetic project instruction marker ${marker}\n`)
await Bun.write(`${profile}/config/opencode.jsonc`, JSON.stringify({ mcp: { servers: { [marker]: { type: "local", command: ["/usr/bin/false"], disabled: true } } } }))
let modelRequested = false
let modelSawPoison = false
let modelSawNativeTools = false
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body = await request.json()
  modelRequested = true
  modelSawPoison ||= JSON.stringify(body.messages).includes(marker)
  modelSawNativeTools ||= JSON.stringify(body.tools ?? []).includes("operation_create")
  const chunk = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({ id: "chatcmpl-isolation", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "isolation", choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  return new Response(chunk({ role: "assistant", content: "Synthetic isolated response." }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
} })
await Bun.write(`${profile}/config/opencode.json`, JSON.stringify({ model: "acceptance/isolation", update: "disable", share: "disabled", snapshots: false, plugins: [{ package: `${checkoutRoot}/packages/ulm` }], agents: { acceptance_isolation: { mode: "primary", system: "Explicit isolated profile agent" } }, providers: { acceptance: { package: "@opencode/ai/providers/openai/chat", settings: { baseURL: `http://127.0.0.1:${provider.port}/v1` }, models: { isolation: { capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 32000, output: 1000 } } } } } }))
const results: { name: string; passed: boolean; detail?: unknown }[] = []
async function check(name: string, passed: boolean, detail?: unknown) { results.push({ name, passed, detail }); console.log(`${name}: ${passed ? "PASS" : "FAIL"}`); await Bun.write(`${run}/results.json`, JSON.stringify({ run, results }, null, 2) + "\n"); if (!passed) throw new Error(name) }
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reservation") })
const port = reservation.port
reservation.stop(true)
const origin = `http://127.0.0.1:${port}`
const password = crypto.randomUUID()
const env = Object.fromEntries(["PATH", "LANG", "LC_ALL", "TERM"].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
Object.assign(env, { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, ULMCODE_PROFILE_ROOT: profile, OPENCODE_TEST_HOME: poisonHome, OPENCODE_PASSWORD: password, OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_FFF: "1", OPENCODE_CONFIG_DIR: `${profile}/config`, OPENCODE_CONFIG: `${profile}/config/opencode.json`, XDG_DATA_HOME: `${profile}/data`, XDG_STATE_HOME: `${profile}/state`, XDG_CACHE_HOME: `${profile}/cache`, XDG_CONFIG_HOME: `${profile}/xdg-config`, OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1" })
const child = Bun.spawn([process.execPath, control ? `${checkoutRoot}/packages/cli/src/index.ts` : `${checkoutRoot}/tools/ulmcode/launch.ts`, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: control ? `${checkoutRoot}/packages/cli` : checkoutRoot, env, stdout: Bun.file(`${run}/host.stdout.log`), stderr: Bun.file(`${run}/host.stderr.log`) })
async function api(route: string) { const response = await fetch(`${origin}${route}`, { headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` }, signal: AbortSignal.timeout(10_000) }); return { status: response.status, body: await response.json() } }
try {
  for (let attempt = 0; attempt < 160; attempt++) { if (child.exitCode !== null) throw new Error(`Launcher exited ${child.exitCode}`); if (await fetch(`${origin}/api/info`, { headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` }, signal: AbortSignal.timeout(500) }).then((response) => response.ok).catch(() => false)) break; await Bun.sleep(100) }
  const location = `?location%5Bdirectory%5D=${encodeURIComponent(workspace)}`
  const skills = await api(`/api/skill${location}`)
  if (!control) await check("actual isolated launcher excludes synthetic home .agents skill", skills.status === 200 && !JSON.stringify(skills.body).includes(marker), { status: skills.status, skillCount: skills.body.data?.length })
  const config = await api(`/api/config${location}`)
  await check(control ? "negative control loads global poison config" : "global and project poison config absent", config.status === 200 && JSON.stringify(config.body).includes(marker) === control, { status: config.status })
  await check("explicit ULM config and plugin remain", JSON.stringify(config.body).includes("acceptance_isolation") && JSON.stringify(config.body).includes(`${checkoutRoot}/packages/ulm`))
  const mcp = await api(`/api/mcp${location}`)
  if (!control) await check("unapproved global MCP absent", mcp.status === 200 && !JSON.stringify(mcp.body).includes(marker), { status: mcp.status })
  const agents = await api(`/api/agent${location}`)
  await Bun.write(`${run}/agent-response.json`, JSON.stringify(agents, null, 2))
  await Bun.write(`${run}/config-response.json`, JSON.stringify(config, null, 2))
  await Bun.write(`${run}/skill-response.json`, JSON.stringify(skills, null, 2))
  const session = await fetch(`${origin}/api/session`, { method: "POST", headers: { authorization: `Basic ${btoa(`opencode:${password}`)}`, "content-type": "application/json" }, body: JSON.stringify({ agent: "acceptance_isolation", model: { providerID: "acceptance", id: "isolation" }, location: { directory: workspace } }) }).then((response) => response.json())
  await fetch(`${origin}/api/session/${session.data.id}/prompt`, { method: "POST", headers: { authorization: `Basic ${btoa(`opencode:${password}`)}`, "content-type": "application/json" }, body: JSON.stringify({ text: "Verify this disposable isolated profile." }) })
  for (let attempt = 0; attempt < 200 && !modelRequested; attempt++) await Bun.sleep(50)
  const registeredAgents = await api(`/api/agent${location}`)
  await check("explicit profile agent registered", registeredAgents.status === 200 && JSON.stringify(registeredAgents.body).includes("acceptance_isolation"), registeredAgents)
  const activatedSkills = await api(`/api/skill${location}`)
  const activatedMCP = await api(`/api/mcp${location}`)
  await check(control ? "negative control loads home skill after activation" : "activated skill registry excludes poisoned home", JSON.stringify(activatedSkills.body).includes(marker) === control)
  await check(control ? "negative control loads disabled poison MCP after activation" : "activated MCP registry excludes global poison", JSON.stringify(activatedMCP.body).includes(marker) === control)
  await check(control ? "negative control sends poison instructions to model" : "model receives no global or project poison instructions", modelRequested && modelSawPoison === control)
  await check("explicit ULM native tools remain activated", modelSawNativeTools)
} finally { child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 5000); await child.exited; clearTimeout(timer); provider.stop(true) }
