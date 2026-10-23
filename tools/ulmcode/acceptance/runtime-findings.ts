import { checkoutRoot, evidenceRoot, chromiumPath } from "./paths"
import { mkdir } from "node:fs/promises"
import path from "node:path"

const repo = checkoutRoot
const bun = process.execPath
const scratch = `${evidenceRoot}/runtime-findings-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`
const profile = path.join(scratch, "profile")
const workspace = path.join(scratch, "workspace")
const config = path.join(profile, "config", "opencode.json")
const operationID = "artifact-finding-fixture"
const password = crypto.randomUUID()
const results: Array<{ at: string; name: string; data: unknown }> = []
const modelRequests: Array<{ kind: string; names: string[] }> = []
let primaryRequests = 0
let findingToolCalls = 0
let artifactReady = false
let normalizedEvidenceID: string | undefined
let releaseArtifact!: () => void
const artifactAvailable = new Promise<void>((resolve) => {
  releaseArtifact = resolve
})
let releaseEvidence!: () => void
const evidenceAvailable = new Promise<void>((resolve) => {
  releaseEvidence = resolve
})
const hasChromium = Boolean(chromiumPath)

await mkdir(path.dirname(config), { recursive: true, mode: 0o700 })
await mkdir(path.join(workspace, ".ulmcode", "operations"), { recursive: true, mode: 0o700 })

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
    const toolNames = (body.tools ?? []).flatMap((tool) => (tool.function?.name ? [tool.function.name] : []))
    modelRequests.push({ kind: isChecker ? "goal-review" : "primary", names: toolNames })
    await Bun.write(path.join(scratch, "model-requests.json"), JSON.stringify(modelRequests, null, 2) + "\n")

    const id = `chatcmpl-${crypto.randomUUID()}`
    const chunk = (delta: object, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "runtime-fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    const response = (content: string) =>
      new Response(chunk({ role: "assistant", content }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    if (isChecker) return response('{"verdict":"continue","reason":"fixture workflow still has open report gates"}')

    primaryRequests += 1
    let name: string | undefined
    let args: object | undefined
    if (primaryRequests === 1) {
      name = "operation_create"
      args = {
        id: operationID,
        objective: "Register a source artifact and promote one evidence-backed synthetic finding",
        targets: ["http://127.0.0.1:9"],
        mode: "synthetic_lab",
        maxNoToolTurns: 0,
      }
    } else if (primaryRequests === 2) {
      await artifactAvailable
      name = "operation_artifacts"
      args = { operationID, artifacts: [{ path: "evidence/source.json", mediaType: "application/json" }] }
    } else if (primaryRequests === 3) {
      name = "evidence_normalize"
      args = { operationID }
    } else if (primaryRequests === 4) {
      name = "operation_findings"
      findingToolCalls += 1
      args = {
        operationID,
        findings: [
          {
            id: "F-SYNTH-1",
            title: "Synthetic fixture response header gap",
            state: "candidate",
            severity: "low",
            description: "The local synthetic response omitted a defensive header in the isolated fixture.",
            affectedAssets: ["http://127.0.0.1:9"],
            evidenceIDs: [],
          },
        ],
      }
    } else if (primaryRequests === 5) {
      await evidenceAvailable
      if (!normalizedEvidenceID)
        return Response.json({ error: "normalized claim ID was not captured" }, { status: 500 })
      name = "operation_findings"
      findingToolCalls += 1
      args = {
        operationID,
        reviewedBy: "synthetic-fixture-reviewer",
        findings: [
          {
            id: "F-SYNTH-1",
            title: "Synthetic fixture response header gap",
            state: "report_ready",
            severity: "low",
            description: "The local synthetic response omitted a defensive header in the isolated fixture.",
            impact: "A browser consumer may miss a defense-in-depth signal in this synthetic response.",
            remediation: "Add the missing header to the local synthetic fixture response.",
            affectedAssets: ["http://127.0.0.1:9"],
            evidenceIDs: [normalizedEvidenceID],
            validationRationale:
              "Confirmed by reading the normalized claim sourced from the registered local fixture artifact.",
          },
        ],
      }
    } else if (hasChromium && primaryRequests === 6) {
      name = "report_render"
      args = { operationID }
    }

    if (name) {
      if (!toolNames.includes(name))
        return Response.json({ error: `native ${name} tool was not registered` }, { status: 500 })
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
    return response("The synthetic artifact and finding workflow was exercised.")
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
    ...["operation_create", "operation_artifacts", "operation_findings", "evidence_normalize", "report_render"].map(
      (resource) => ({ action: "tool.use", resource, effect: "allow" }),
    ),
  ],
  providers: {
    acceptance: {
      package: "@opencode/ai/providers/openai/chat",
      settings: { baseURL: `http://127.0.0.1:${provider.port}/v1` },
      models: {
        "runtime-fixture": {
          name: "Runtime artifact fixture",
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
        "Use operation_create, operation_artifacts to register an existing relative artifact, evidence_normalize, then operation_findings. First register a candidate. Promote it to report_ready only when a normalized evidence claim is available and include reviewer and validation rationale. Call report_render only when it is available.",
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
if (hasChromium) Object.assign(env, { ULMCODE_CHROMIUM: chromiumPath })
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
    JSON.stringify(
      { scratch, command, model: "fixture-only-no-paid-provider", chromiumConfigured: hasChromium, results },
      null,
      2,
    ) + "\n",
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
  return Bun.file(path.join(workspace, ".ulmcode", "operations", operationID, "operation.json")).json() as Promise<{
    id: string
    artifacts: Array<{ path: string; sha256?: string }>
    evidence?: { claims: Array<{ id: string; source: { path: string } }> }
    executions: unknown[]
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
    title: "Native runtime artifact and findings acceptance",
    model: { providerID: "acceptance", id: "runtime-fixture" },
    agent: "runtime_acceptance",
    location: { directory: workspace },
  })
  if (created.status !== 200 || !created.body) throw new Error(`Session creation failed (${created.status})`)
  const sessionID = (created.body.data as { id: string }).id
  await note("launcher and local plugin started", {
    pid: child.pid,
    sessionID,
    pluginDirectory: path.join(repo, "packages", "ulm"),
  })
  const prompt = await api("POST", `/api/session/${sessionID}/prompt`, {
    text: "Register the synthetic source artifact, normalize it, and record one finding.",
  })
  if (prompt.status !== 200) throw new Error(`Prompt failed (${prompt.status})`)

  await waitUntil(
    async () => Bun.file(path.join(workspace, ".ulmcode", "operations", operationID, "operation.json")).exists(),
    "operation creation",
  )
  const operationRoot = path.join(workspace, ".ulmcode", "operations", operationID)
  await mkdir(path.join(operationRoot, "evidence"), { recursive: true, mode: 0o700 })
  await Bun.write(
    path.join(operationRoot, "evidence", "source.json"),
    JSON.stringify(
      {
        observations: [
          {
            kind: "http-response",
            subject: "local synthetic service",
            summary: "The synthetic response did not include X-Frame-Options in the isolated test fixture.",
            confidence: 0.95,
          },
        ],
      },
      null,
      2,
    ) + "\n",
  )
  artifactReady = true
  releaseArtifact()

  await waitUntil(async () => {
    const record = await readOperation().catch(() => undefined)
    return record?.evidence?.claims.length === 1
  }, "normalized synthetic claim")
  const afterNormalization = await readOperation()
  normalizedEvidenceID = afterNormalization.evidence!.claims[0]!.id
  releaseEvidence()

  await waitUntil(async () => {
    const record = await readOperation().catch(() => undefined)
    return record?.artifacts.some((artifact) => artifact.path === "findings/findings.json") === true
  }, "domain-validated canonical finding document")
  await waitUntil(async () => primaryRequests >= (hasChromium ? 7 : 6), "native artifact and finding tool flow")
  const final = await readOperation()
  const source = final.artifacts.find((artifact) => artifact.path === "evidence/source.json")
  const findings = final.artifacts.find((artifact) => artifact.path === "findings/findings.json")
  const findingDocument = (await Bun.file(path.join(operationRoot, "findings", "findings.json")).json()) as {
    operationID: string
    findings: Array<{ id: string; state: string; reviewedBy?: string; evidenceIDs: string[] }>
  }
  await check(
    "operation_artifacts registered a contained file by engine-computed hash",
    Boolean(source?.sha256) && source?.path === "evidence/source.json",
    source,
  )
  await check(
    "candidate was promoted only with normalized evidence and explicit reviewer",
    findingDocument.operationID === operationID &&
      findingDocument.findings.length === 1 &&
      findingDocument.findings[0]?.state === "report_ready" &&
      findingDocument.findings[0]?.reviewedBy === "synthetic-fixture-reviewer" &&
      findingDocument.findings[0]?.evidenceIDs.includes(normalizedEvidenceID!),
    findingDocument.findings,
  )
  await check(
    "canonical findings document is registered by engine-computed hash",
    Boolean(findings?.sha256) && findings?.path === "findings/findings.json",
    findings,
  )
  await check(
    "model called both new native tools",
    modelRequests.some((item) => item.names.includes("operation_artifacts")) &&
      modelRequests.filter((item) => item.names.includes("operation_findings")).length >= 2,
    modelRequests.map((item) => item.names),
  )
  if (hasChromium) {
    await waitUntil(
      async () =>
        (await readOperation()).artifacts.some((artifact) => artifact.path === "deliverables/final/report.pdf"),
      "rendered canonical report PDF",
    )
    const report = await readOperation()
    await check(
      "report_render produced canonical PDF from report-ready finding",
      report.artifacts.some((artifact) => artifact.path === "deliverables/final/report.pdf"),
      report.artifacts.filter((artifact) => artifact.path.startsWith("deliverables/final/")),
    )
  }
} catch (error) {
  await note("failure", { error: String(error), primaryRequests, findingToolCalls, normalizedEvidenceID })
  process.exitCode = 1
} finally {
  releaseArtifact()
  releaseEvidence()
  child.kill("SIGTERM")
  await Promise.race([child.exited, Bun.sleep(5000).then(() => child.kill("SIGKILL"))])
  provider.stop(true)
  await note("cleanup", { hostPID: child.pid, hostExitCode: child.exitCode, providerStopped: true })
}
