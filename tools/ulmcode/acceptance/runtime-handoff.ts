import { checkoutRoot, evidenceRoot } from "./paths"
import { mkdir } from "node:fs/promises"
import path from "node:path"

const repo = checkoutRoot
const bun = process.execPath
const scenario = process.env.RUNTIME_HOST_SCENARIO ?? "approval-denial"
if (
  ![
    "approval-denial",
    "handoff-complete",
    "handoff-cancel-retry",
    "authorized-catalog",
    "authorized-no-catalog",
    "authorized-invalid-profile",
  ].includes(scenario)
)
  throw new Error(`unknown scenario ${scenario}`)
const scratch = `${evidenceRoot}/runtime-handoff-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}-${scenario}`
const profile = path.join(scratch, "profile")
const workspace = path.join(scratch, "workspace")
const config = path.join(profile, "config", "opencode.json")
const password = crypto.randomUUID()
const results: Array<{ at: string; name: string; data: unknown }> = []
const modelRequests: Array<{ kind: string; names: string[] }> = []
let primaryRequests = 0
let toolCalls = 0
let childRequests = 0
let childRequestAborted = false
let releaseStalledChild!: () => void
const stalledChild = new Promise<void>((resolve) => {
  releaseStalledChild = resolve
})

await mkdir(path.dirname(config), { recursive: true, mode: 0o700 })
await mkdir(path.join(workspace, ".ulmcode", "operations"), { recursive: true, mode: 0o700 })
const catalogPath = path.join(scratch, "command-catalog.json")
await Bun.write(
  catalogPath,
  JSON.stringify(
    {
      schemaVersion: 1,
      profiles: [
        {
          profileID: "fixture-command",
          safety: "non_destructive",
          scopes: ["authorized"],
          executable: "/usr/bin/printf",
          args: ["synthetic-command-fixture"],
          variables: {},
          targetPolicy: "scoped",
          timeoutMs: 5000,
          maxOutputBytes: 4096,
          restart: "safe",
        },
      ],
    },
    null,
    2,
  ) + "\n",
)

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
    const allText = JSON.stringify(messages)
    const isChecker = allText.includes("hidden goal-checker for a ULM operation")
    const isChild =
      allText.includes("You are a subagent spawned by another session") ||
      allText.includes("Operation runtime-acceptance; phase")
    const toolNames = (body.tools ?? []).flatMap((tool) => (tool.function?.name ? [tool.function.name] : []))
    modelRequests.push({ kind: isChecker ? "goal-review" : isChild ? "child" : "primary", names: toolNames })
    await Bun.write(path.join(scratch, "model-requests.json"), JSON.stringify(modelRequests, null, 2) + "\n")

    const id = `chatcmpl-${crypto.randomUUID()}`
    const chunk = (delta: object, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "runtime-fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    const response = (content: string) =>
      new Response(chunk({ role: "assistant", content }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    if (isChecker) return response('{"verdict":"continue","reason":"synthetic fixture keeps the operation active"}')

    if (isChild) {
      childRequests += 1
      if (scenario === "handoff-cancel-retry" && childRequests === 1) {
        if (request.signal.aborted) childRequestAborted = true
        else
          await Promise.race([
            stalledChild,
            new Promise<void>((resolve) =>
              request.signal.addEventListener(
                "abort",
                () => {
                  childRequestAborted = true
                  resolve()
                },
                { once: true },
              ),
            ),
          ])
        return new Response("", { status: 499 })
      }
      return response("Synthetic child completed its phase prompt; no external action was performed.")
    }

    primaryRequests += 1
    const phase = {
      id: "phase_fixture",
      title: "Synthetic handoff fixture",
      dependsOn: [],
      successCriteria: ["Return one fixture completion statement"],
      restart: "safe",
      required: true,
      expectedArtifacts: ["authorized-catalog", "authorized-no-catalog", "authorized-invalid-profile"].includes(
        scenario,
      )
        ? []
        : ["subagents/phase_fixture/result.txt"],
      ...(["authorized-catalog", "authorized-no-catalog", "authorized-invalid-profile"].includes(scenario)
        ? {
            command: {
              profileID: scenario === "authorized-invalid-profile" ? "missing-profile" : "fixture-command",
              variables: {},
            },
          }
        : {}),
    }
    let name: string | undefined
    let args: object | undefined
    if (primaryRequests === 1) {
      name = "operation_create"
      args = {
        id: "runtime-acceptance",
        objective: "Verify native operation permission and handoff behavior through the real Host",
        targets: ["http://127.0.0.1:9"],
        mode: ["authorized-catalog", "authorized-no-catalog", "authorized-invalid-profile"].includes(scenario)
          ? "authorized"
          : "synthetic_lab",
        maxNoToolTurns: 0,
        ...(["authorized-catalog", "authorized-no-catalog", "authorized-invalid-profile"].includes(scenario)
          ? { authorizationRef: "fixture-approved-scope" }
          : {}),
        plan: {
          assumptions: ["Fixture only"],
          successCriteria: ["Exercise the native handoff lifecycle"],
          phases: [phase],
        },
      }
    } else if (primaryRequests === 2) {
      name = "operation_approve_plan"
      args = { operationID: "runtime-acceptance", approvedBy: "synthetic-fixture-operator" }
    } else if (
      ["authorized-catalog", "authorized-no-catalog", "authorized-invalid-profile"].includes(scenario) &&
      (primaryRequests === 3 || (scenario === "authorized-catalog" && primaryRequests === 4))
    ) {
      name = "operation_run"
      args = { operationID: "runtime-acceptance" }
    } else if (
      scenario !== "approval-denial" &&
      !["authorized-catalog", "authorized-no-catalog", "authorized-invalid-profile"].includes(scenario) &&
      (primaryRequests === 3 || (scenario === "handoff-cancel-retry" && primaryRequests === 4))
    ) {
      name = "operation_handoff"
      args = {
        operationID: "runtime-acceptance",
        phaseID: "phase_fixture",
        agent: "runtime_child",
        task: "Return a short synthetic phase completion statement.",
      }
    }

    if (name) {
      if (!toolNames.includes(name))
        return Response.json({ error: `native ${name} tool was not registered` }, { status: 500 })
      toolCalls += 1
      return new Response(
        chunk(
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call-${crypto.randomUUID()}`,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
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
    return response(`Synthetic ${scenario} primary turn completed.`)
  },
})

const portReservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reservation") })
const hostPort = portReservation.port
portReservation.stop(true)
const origin = `http://127.0.0.1:${hostPort}`
const permissions = [
  { action: "operation_approve_plan", resource: "*", effect: scenario === "approval-denial" ? "ask" : "allow" },
  { action: "subagent", resource: "runtime_child", effect: "allow" },
]
const profileConfig = {
  model: "acceptance/runtime-fixture",
  default_agent: "runtime_acceptance",
  update: "disable",
  share: "disabled",
  snapshots: false,
  plugins: [{ package: path.join(repo, "packages", "ulm") }],
  permissions,
  policies: [
    { action: "provider.use", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "acceptance", effect: "allow" },
    { action: "tool.use", resource: "operation_create", effect: "allow" },
    { action: "tool.use", resource: "operation_approve_plan", effect: "allow" },
    { action: "tool.use", resource: "operation_handoff", effect: "allow" },
  ],
  providers: {
    acceptance: {
      package: "@opencode/ai/providers/openai/chat",
      settings: { baseURL: `http://127.0.0.1:${provider.port}/v1` },
      models: {
        "runtime-fixture": {
          name: "Runtime lifecycle fixture",
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          limit: { context: 16000, output: 1000 },
        },
      },
    },
  },
  agents: {
    runtime_acceptance: {
      mode: "primary",
      steps: 12,
      system:
        "For the first user prompt, use operation_create with the inline phase plan. Then use operation_approve_plan. For the handoff fixture call, use operation_handoff after approval. Do not call other tools.",
    },
    runtime_child: {
      mode: "subagent",
      steps: 2,
      system: "You are a fixture-only child. Return one sentence and do not use tools.",
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
if (scenario === "authorized-catalog" || scenario === "authorized-invalid-profile")
  Object.assign(env, { ULMCODE_COMMAND_CATALOG: catalogPath })
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
    JSON.stringify({ scenario, scratch, command, model: "fixture-only-no-paid-provider", results }, null, 2) + "\n",
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
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null }
}

async function check(name: string, passed: boolean, data: unknown) {
  await note(`assert ${name}`, { passed, data })
  if (!passed) throw new Error(name)
}

async function waitUntil(test: () => Promise<boolean>, description: string, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`launcher exited with ${child.exitCode}`)
    if (await test()) return
    await Bun.sleep(100)
  }
  throw new Error(`timed out waiting for ${description}`)
}

async function readOperation() {
  const file = path.join(workspace, ".ulmcode", "operations", "runtime-acceptance", "operation.json")
  return Bun.file(file).json() as Promise<{
    id: string
    plan?: { approvedAt?: string; phases: Array<{ id: string; status: string }> }
    sessionIDs: string[]
    handoffs: Array<{ phaseID: string; childID: string; status: string }>
  }>
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
  )
  const created = await api("POST", "/api/session", {
    title: `Native runtime ${scenario}`,
    model: { providerID: "acceptance", id: "runtime-fixture" },
    agent: "runtime_acceptance",
    location: { directory: workspace },
  })
  if (created.status !== 200 || !created.body) throw new Error(`Session creation failed (${created.status})`)
  const sessionID = (created.body.data as { id: string }).id
  await note("launcher and local plugin started", {
    pid: child.pid,
    scenario,
    sessionID,
    pluginDirectory: path.join(repo, "packages", "ulm"),
  })
  const firstPrompt = await api("POST", `/api/session/${sessionID}/prompt`, {
    text: `RUNTIME_${scenario.toUpperCase()}: execute the native operation flow.`,
  })
  if (firstPrompt.status !== 200) throw new Error(`Prompt failed (${firstPrompt.status})`)

  if (scenario === "approval-denial") {
    await waitUntil(async () => {
      const pending = await api("GET", `/api/session/${sessionID}/permission`)
      return (
        pending.status === 200 &&
        Array.isArray((pending.body?.data as unknown[]) ?? []) &&
        (pending.body?.data as Array<{ action: string }>).some((item) => item.action === "operation_approve_plan")
      )
    }, "operator approval request")
    const pending = await api("GET", `/api/session/${sessionID}/permission`)
    const request = (pending.body?.data as Array<{ id: string; action: string }>).find(
      (item) => item.action === "operation_approve_plan",
    )!
    const reply = await api("POST", `/api/session/${sessionID}/permission/${request.id}/reply`, {
      decision: "reject",
      message: "fixture operator declines plan approval",
    })
    await waitUntil(async () => primaryRequests >= 3 && toolCalls >= 2, "provider receives permission rejection result")
    const operation = await readOperation()
    await check("real permission request was rejected over HTTP", reply.status === 204, {
      request: { id: request.id, action: request.action },
      status: reply.status,
    })
    await check(
      "rejected approval leaves plan unapproved",
      operation.plan?.approvedAt === undefined && operation.plan?.phases[0]?.status === "ready",
      { approvedAt: operation.plan?.approvedAt, phase: operation.plan?.phases[0] },
    )
    await check(
      "provider invoked the native create and approve tools",
      toolCalls === 2 && modelRequests.some((item) => item.names.includes("operation_approve_plan")),
      { toolCalls, names: modelRequests.map((item) => item.names) },
    )
  }

  if (scenario === "handoff-complete") {
    await waitUntil(async () => {
      const operation = await readOperation().catch(() => undefined)
      return operation?.handoffs.some((item) => item.status === "completed") === true
    }, "completed child handoff")
    const operation = await readOperation()
    await check(
      "native handoff waited for and recorded child completion",
      operation.handoffs.length === 1 && operation.handoffs[0]?.status === "completed",
      operation.handoffs,
    )
    await check(
      "child session was durably bound to the operation",
      operation.sessionIDs.includes(operation.handoffs[0]!.childID),
      operation.sessionIDs,
    )
    await check(
      "local provider executed parent and child turns",
      childRequests === 1 && modelRequests.some((item) => item.kind === "child"),
      { childRequests, modelRequests },
    )
  }

  if (scenario === "handoff-cancel-retry") {
    await waitUntil(
      async () =>
        (await readOperation().catch(() => undefined))?.handoffs.some((item) => item.status === "accepted") === true,
      "accepted child handoff",
    )
    const operationBeforeInterrupt = await readOperation()
    const childID = operationBeforeInterrupt.handoffs.find((item) => item.status === "accepted")!.childID
    await waitUntil(async () => childRequests === 1, "first child provider request")
    const interrupted = await api("POST", `/api/session/${sessionID}/interrupt`)
    await waitUntil(async () => childRequestAborted, "child provider request cancellation")
    await waitUntil(
      async () =>
        (await readOperation()).handoffs.some((item) => item.childID === childID && item.status === "rejected"),
      "durable cancellation handoff status",
    )
    await check(
      "parent interrupt cancels active child provider request",
      interrupted.status === 200 && interrupted.body?.interrupted === true && childRequestAborted,
      { interrupted: interrupted.body, childID },
    )

    const retryPrompt = await api("POST", `/api/session/${sessionID}/prompt`, {
      text: "RUNTIME_HANDOFF_RETRY: retry the cancelled phase with one new child.",
    })
    if (retryPrompt.status !== 200) throw new Error(`Retry prompt failed (${retryPrompt.status})`)
    await waitUntil(
      async () => (await readOperation()).handoffs.some((item) => item.status === "completed"),
      "retried child handoff completion",
    )
    const retried = await readOperation()
    const completed = retried.handoffs.filter((item) => item.status === "completed")
    await check(
      "retry uses a new child after cancellation and does not duplicate an active child",
      retried.handoffs.length === 2 &&
        retried.handoffs[0]?.status === "rejected" &&
        completed.length === 1 &&
        completed[0]?.childID !== childID,
      retried.handoffs,
    )
    await check("cancelled child is no longer running", childRequestAborted && childRequests === 2, {
      childRequestAborted,
      childRequests,
    })
  }

  if (["authorized-catalog", "authorized-no-catalog", "authorized-invalid-profile"].includes(scenario)) {
    await waitUntil(
      async () => primaryRequests >= (scenario === "authorized-catalog" ? 5 : 4),
      "authorized command tool turns",
    )
    if (scenario === "authorized-catalog") {
      await waitUntil(
        async () => (await readOperation()).plan?.phases[0]?.status === "complete",
        "local catalog command completion",
      )
      const operation = await readOperation()
      await check(
        "trusted local command profile completed without network execution",
        operation.plan?.phases[0]?.status === "complete" && operation.handoffs.length === 0,
        operation.plan?.phases[0],
      )
    } else {
      const operation = await readOperation()
      await check(
        "authorized operation fails closed before launch without valid catalog profile",
        operation.plan?.phases[0]?.status === "ready" && operation.handoffs.length === 0,
        { phase: operation.plan?.phases[0], catalogConfigured: scenario !== "authorized-no-catalog" },
      )
    }
  }
} catch (error) {
  await note("failure", { error: String(error), primaryRequests, toolCalls, childRequests, childRequestAborted })
  process.exitCode = 1
} finally {
  releaseStalledChild()
  child.kill("SIGTERM")
  await Promise.race([child.exited, Bun.sleep(5000).then(() => child.kill("SIGKILL"))])
  provider.stop(true)
  await note("cleanup", { hostPID: child.pid, hostExitCode: child.exitCode, providerStopped: true })
}
