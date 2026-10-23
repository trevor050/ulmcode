import { checkoutRoot, evidenceRoot } from "./paths"
import { mkdir } from "node:fs/promises"
import path from "node:path"

const repo = checkoutRoot
const bun = process.execPath
const scratch = `${evidenceRoot}/runtime-continuation-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`
const profile = path.join(scratch, "profile")
const workspace = path.join(scratch, "workspace")
const config = path.join(profile, "config", "opencode.json")
const results: Array<{ at: string; name: string; data: unknown }> = []
await mkdir(path.dirname(config), { recursive: true, mode: 0o700 })
await mkdir(path.join(workspace, ".ulmcode", "operations"), { recursive: true, mode: 0o700 })

const password = crypto.randomUUID()
const modelRequests: Array<{ at: string; kind: "primary" | "goal-review"; names: string[] }> = []
let reviewResponses = 0
const goalVerdict = process.env.RUNTIME_FIXTURE_VERDICT === "done" ? "done" : "continue"
let primaryResponses = 0
let operationToolCalls = 0

const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (!new URL(request.url).pathname.endsWith("/chat/completions"))
      return Response.json({ error: "unexpected fixture route" }, { status: 404 })
    const body = (await request.json()) as {
      tools?: Array<{ function?: { name?: string } }>
      messages?: Array<{ role?: string; content?: string | Array<{ text?: string }> }>
    }
    const messages = body.messages ?? []
    const userText = messages
      .filter((item) => item.role === "user")
      .flatMap((item) =>
        typeof item.content === "string"
          ? [item.content]
          : (item.content?.flatMap((part) => (part.text ? [part.text] : [])) ?? []),
      )
    const promptText = userText.join("\n")
    const allText = JSON.stringify(messages)
    const goalReview = allText.includes("hidden goal-checker for a ULM operation")
    const toolNames = (body.tools ?? []).flatMap((tool) => (tool.function?.name ? [tool.function.name] : []))
    modelRequests.push({ at: new Date().toISOString(), kind: goalReview ? "goal-review" : "primary", names: toolNames })
    await Bun.write(path.join(scratch, "model-requests.json"), JSON.stringify(modelRequests, null, 2) + "\n")

    const id = `chatcmpl-${crypto.randomUUID()}`
    const chunk = (delta: object, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "runtime-fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    if (goalReview) {
      reviewResponses += 1
      const content = `{"verdict":"${goalVerdict}","reason":"fixture checks gate handling (${reviewResponses})"}`
      return new Response(chunk({ role: "assistant", content }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    }

    primaryResponses += 1
    if (promptText.includes("RUNTIME_PLUGIN_CREATE") && primaryResponses === 1) {
      if (!toolNames.includes("operation_create"))
        return Response.json({ error: "native operation_create tool was not registered" }, { status: 500 })
      operationToolCalls += 1
      const args = {
        objective: "Verify isolated native plugin tool registration and bounded goal continuation",
        targets: ["http://127.0.0.1:9"],
        mode: "synthetic_lab",
        maxNoToolTurns: 1,
      }
      return new Response(
        chunk(
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call-${crypto.randomUUID()}`,
                type: "function",
                function: { name: "operation_create", arguments: JSON.stringify(args) },
              },
            ],
          },
          null,
        ) +
          chunk({}, "tool_calls") +
          "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    }
    const content = `Synthetic primary turn ${primaryResponses}; no tool call requested.`
    return new Response(chunk({ role: "assistant", content }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    })
  },
})

const portReservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reservation") })
const hostPort = portReservation.port
portReservation.stop(true)
const origin = `http://127.0.0.1:${hostPort}`
const profileConfig = {
  model: "acceptance/runtime-fixture",
  default_agent: "runtime_acceptance",
  update: "disable",
  share: "disabled",
  snapshots: false,
  plugins: [{ package: path.join(repo, "packages", "ulm") }],
  policies: [
    { action: "provider.use", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "acceptance", effect: "allow" },
    { action: "tool.use", resource: "operation_create", effect: "allow" },
  ],
  providers: {
    acceptance: {
      package: "@opencode/ai/providers/openai/chat",
      settings: { baseURL: `http://127.0.0.1:${provider.port}/v1` },
      models: {
        "runtime-fixture": {
          name: "Runtime continuation fixture",
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          limit: { context: 16000, output: 1000 },
        },
      },
    },
  },
  agents: {
    runtime_acceptance: {
      mode: "primary",
      steps: 8,
      system:
        "Use the native operation_create tool when the user says RUNTIME_PLUGIN_CREATE. After the operation is created, answer in one sentence. For synthetic continuation prompts, answer without tools.",
    },
  },
}
await Bun.write(config, JSON.stringify(profileConfig, null, 2) + "\n")
await Bun.write(
  path.join(scratch, "fixture-config.json"),
  JSON.stringify(
    { ...profileConfig, providers: { acceptance: { models: ["runtime-fixture"], baseURL: "loopback fixture" } } },
    null,
    2,
  ) + "\n",
)

const env = Object.fromEntries(
  ["PATH", "LANG", "LC_ALL", "TERM", "SYSTEMROOT", "WINDIR"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]!]] : [],
  ),
)
Object.assign(env, {
  PATH: `${path.dirname(bun)}:${process.env.PATH}`,
  ULMCODE_PROFILE_ROOT: profile,
  OPENCODE_PASSWORD: password,
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_FFF: "1",
})
const command = [
  bun,
  path.join(repo, "tools", "ulmcode", "launch.ts"),
  "serve",
  "--hostname",
  "127.0.0.1",
  "--port",
  String(hostPort),
]
const child = Bun.spawn(command, {
  cwd: repo,
  env,
  stdout: Bun.file(path.join(scratch, "host.stdout.log")),
  stderr: Bun.file(path.join(scratch, "host.stderr.log")),
})

async function note(name: string, data: unknown) {
  results.push({ at: new Date().toISOString(), name, data })
  await Bun.write(
    path.join(scratch, "results.json"),
    JSON.stringify({ scratch, command, model: "fixture-only-no-paid-provider", results }, null, 2) + "\n",
  )
  console.log(name)
}

async function api(method: string, route: string, body?: object) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

async function check(name: string, passed: boolean, data: unknown) {
  await note(`assert ${name}`, { passed, data })
  if (!passed) throw new Error(name)
}

async function waitUntil(test: () => Promise<boolean>, description: string, timeout = 45_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`launcher exited with ${child.exitCode}`)
    if (await test()) return
    await Bun.sleep(100)
  }
  throw new Error(`timed out waiting for ${description}`)
}

try {
  await waitUntil(
    async () =>
      fetch(`${origin}/api/info`, {
        headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
        signal: AbortSignal.timeout(1000),
      })
        .then((response) => response.ok)
        .catch(() => false),
    "launcher API",
    60_000,
  )
  await note("launcher started", { pid: child.pid, origin, scratch, pluginTarget: profileConfig.plugins[0]?.package })
  const created = await api("POST", "/api/session", {
    title: "Native runtime plugin acceptance",
    model: { providerID: "acceptance", id: "runtime-fixture" },
    agent: "runtime_acceptance",
    location: { directory: workspace },
  })
  if (created.status !== 200) throw new Error(`Session creation failed (${created.status})`)
  const sessionID = created.body.data.id as string
  const prompt = await api("POST", `/api/session/${sessionID}/prompt`, {
    text: "RUNTIME_PLUGIN_CREATE: create and bind an operation.",
  })
  if (prompt.status !== 200) throw new Error(`Prompt failed (${prompt.status})`)
  await waitUntil(
    async () => operationToolCalls === 1 && primaryResponses >= 3 && reviewResponses >= 3,
    "bounded continuation and no-tool stop",
  )
  await waitUntil(async () => {
    const response = await api("GET", `/api/session/${sessionID}/inbox`)
    return (
      response.status === 200 &&
      response.body.data.some(
        (item: { type: string; payload?: { description?: string } }) =>
          item.type === "synthetic" && item.payload?.description === "ULM goal continuation limit notice",
      )
    )
  }, "persisted non-resuming goal limit notice")
  await waitUntil(async () => {
    const entries = await Array.fromAsync(
      new Bun.Glob("*/operation.json").scan({ cwd: path.join(workspace, ".ulmcode", "operations") }),
    )
    if (!entries.length) return false
    const operation = (await Bun.file(path.join(workspace, ".ulmcode", "operations", entries[0]!)).json()) as {
      goal?: { continuation?: { noToolStreak?: number } }
    }
    return operation.goal?.continuation?.noToolStreak === 2
  }, "durable bounded no-tool streak")

  const messages = await api("GET", `/api/session/${sessionID}/message?order=asc&limit=100`)
  const operation = (
    await Array.fromAsync(
      new Bun.Glob("*/operation.json").scan({ cwd: path.join(workspace, ".ulmcode", "operations") }),
    )
  )[0]
  const stored = (await Bun.file(path.join(workspace, ".ulmcode", "operations", operation!)).json()) as {
    id: string
    sessionIDs: string[]
    goal: { continuation: { maxNoToolTurns: number; noToolStreak: number }; review?: { verdict: string } }
  }
  await check(
    "native operation_create tool loaded",
    operationToolCalls === 1 && modelRequests[0]?.names.includes("operation_create") === true,
    { operationID: stored.id, tools: modelRequests[0]?.names },
  )
  await check(
    "operation bound only to created session",
    stored.sessionIDs.length === 1 && stored.sessionIDs[0] === sessionID,
    stored.sessionIDs,
  )
  await check(
    "continuation stopped at configured bound",
    stored.goal.continuation.maxNoToolTurns === 1 && stored.goal.continuation.noToolStreak === 2,
    stored.goal.continuation,
  )
  const inbox = await api("GET", `/api/session/${sessionID}/inbox`)
  await check(
    "non-resuming limit notice is durable",
    inbox.status === 200 &&
      inbox.body.data.some(
        (item: { type: string; payload?: { description?: string } }) =>
          item.type === "synthetic" && item.payload?.description === "ULM goal continuation limit notice",
      ),
    inbox.body.data.map((item: { type: string; payload?: { description?: string } }) => ({
      type: item.type,
      description: item.payload?.description,
    })),
  )
  const missingGateContinuation =
    messages.status === 200 &&
    messages.body.data.some(
      (item: { type: string; text?: string }) =>
        item.type === "synthetic" &&
        item.text?.startsWith("The goal checker found these required artifact gates still open:"),
    )
  await check(
    "done verdict with missing gates continues with blockers",
    goalVerdict !== "done" || missingGateContinuation,
    messages.body.data.map((item: { type: string; text?: string }) => ({
      type: item.type,
      missingGateContinuation:
        item.text?.startsWith("The goal checker found these required artifact gates still open:") === true,
    })),
  )
  await check(
    "fixture drove goal reviews through provider API",
    reviewResponses === 3 && modelRequests.filter((item) => item.kind === "goal-review").length === 3,
    { reviewResponses, goalVerdict, modelRequests },
  )
} catch (error) {
  await note("failure", { error: String(error) })
  process.exitCode = 1
} finally {
  child.kill("SIGTERM")
  await Promise.race([child.exited, Bun.sleep(5000).then(() => child.kill("SIGKILL"))])
  provider.stop(true)
  await note("cleanup", { hostPID: child.pid, hostExitCode: child.exitCode, providerStopped: true })
}
