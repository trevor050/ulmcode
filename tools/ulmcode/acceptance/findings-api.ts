import { mkdir, symlink, unlink } from "node:fs/promises"
import { checkoutRoot, evidenceRoot, chromiumPath } from "./paths"

const run = `${evidenceRoot}/findings-api-${new Date().toISOString().replace(/[:.]/g, "-")}`
const workspace = `${run}/workspace`
const operationRoot = `${workspace}/.ulmcode/operations/findings-proof`
const results: { name: string; passed: boolean; detail?: unknown }[] = []
await mkdir(`${workspace}/.ulmcode/operations`, { recursive: true })
const lab = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) =>
    new URL(request.url).pathname === "/health"
      ? Response.json({ status: "ok" })
      : Response.json({
          lab: "Independent synthetic findings lab",
          observations: [
            {
              kind: "informational",
              subject: "local fixture",
              summary: "Actual local response is explicitly synthetic and contains no real vulnerability",
            },
          ],
        }),
})
const target = `http://127.0.0.1:${lab.port}`
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reservation") })
const origin = `http://127.0.0.1:${reservation.port}`
const port = reservation.port
reservation.stop(true)
const host = Bun.spawn(
  [
    process.execPath,
    `${checkoutRoot}/packages/ulm/src/cli.ts`,
    "serve",
    "--workspace",
    workspace,
    "--port",
    String(port),
    "--chromium",
    chromiumPath,
  ],
  { cwd: checkoutRoot, stdout: Bun.file(`${run}/host.stdout.log`), stderr: Bun.file(`${run}/host.stderr.log`) },
)
async function api(method: string, route: string, body?: object) {
  const response = await fetch(`${origin}/api/operations${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  return { status: response.status, body: await response.json() }
}
async function check(name: string, passed: boolean, detail?: unknown) {
  results.push({ name, passed, detail })
  await Bun.write(`${run}/results.json`, JSON.stringify({ run, results }, null, 2) + "\n")
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`)
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (host.exitCode !== null) throw new Error("Host exited")
    if (
      await fetch(`${origin}/health`)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break
    await Bun.sleep(50)
  }
  const created = await api("POST", "", {
    id: "findings-proof",
    sessionID: "findings-session",
    objective: "Independently validate explicit synthetic evidence and reviewed finding flow",
    scope: { targets: [target], mode: "synthetic_lab" },
  })
  await check("public operation creates", created.status === 201)
  await api("POST", "/findings-proof/approve", { approvedBy: "independent-operator" })
  await api("POST", "/findings-proof/run", {})
  await api("POST", "/findings-proof/run", {})
  await mkdir(`${operationRoot}/evidence`, { recursive: true })
  const responseText = await fetch(`${target}/api/lab`).then((response) => response.text())
  await Bun.write(`${operationRoot}/evidence/source.json`, responseText)
  const register = { artifacts: [{ path: "evidence/source.json", mediaType: "application/json" }] }
  const registered = await api("POST", "/findings-proof/artifacts", register)
  const retried = await api("POST", "/findings-proof/artifacts", register)
  await check(
    "source hashes computed and exact registration is a no-op",
    registered.status === 200 &&
      registered.body.operation.artifacts.some(
        (item: { path: string; sha256?: string }) => item.path === "evidence/source.json" && item.sha256?.length === 64,
      ) &&
      retried.body.operation.revision === registered.body.operation.revision,
  )
  await Bun.write(`${run}/outside.txt`, "Outside synthetic scope")
  await symlink(`${run}/outside.txt`, `${operationRoot}/evidence/escape.txt`)
  for (const path of [
    "../outside.txt",
    `${run}/outside.txt`,
    "evidence/escape.txt",
    "findings/arbitrary.json",
    "findings/findings.json",
  ])
    await check(
      `registration rejects ${path.startsWith(run) ? "absolute path" : path}`,
      (await api("POST", "/findings-proof/artifacts", { artifacts: [{ path }] })).status >= 400,
    )
  const normalized = await api("POST", "/findings-proof/normalize", {})
  const evidenceID =
    normalized.body.operation.evidence.claims.find(
      (claim: { source: string }) => claim.source === "evidence/source.json",
    )?.id ?? normalized.body.operation.evidence.claims[0]?.id
  if (!evidenceID) throw new Error("No actual normalized evidence ID")
  const finding = {
    id: "SYNTH-ACCEPTANCE",
    title: "Explicit synthetic fixture observation",
    state: "candidate",
    severity: "informational",
    description:
      "This is a synthetic-only observation backed by a real local test response, not a real security vulnerability.",
    affectedAssets: [target],
    evidenceIDs: [evidenceID],
  }
  const candidate = await api("POST", "/findings-proof/findings", { findings: [finding] })
  await check("candidate records through real API", candidate.status === 200)
  await check(
    "candidate cannot disappear through omitted collection",
    (await api("POST", "/findings-proof/findings", { findings: [] })).status >= 400,
  )
  const candidateReport = await api("POST", "/findings-proof/report", {})
  await check(
    "unreviewed candidate cannot complete goal",
    candidateReport.status >= 400 || candidateReport.body.operation.goal.status !== "complete",
  )
  const reviewed = {
    ...finding,
    state: "report_ready",
    impact: "Synthetic fixture demonstrates evidence traceability only.",
    remediation: "Retain explicit synthetic labeling and evidence provenance.",
    validationRationale:
      "Independently fetched the local response and checked the normalized evidence claim; this is test-only validation.",
  }
  await check(
    "reportable state requires operator review",
    (await api("POST", "/findings-proof/findings", { findings: [reviewed] })).status >= 400,
  )
  await check(
    "unknown evidence cannot support reviewed finding",
    (
      await api("POST", "/findings-proof/findings", {
        reviewedBy: "independent-reviewer",
        findings: [{ ...reviewed, evidenceIDs: ["another-operation-evidence"] }],
      })
    ).status >= 400,
  )
  await check(
    "duplicate finding IDs rejected",
    (
      await api("POST", "/findings-proof/findings", {
        reviewedBy: "independent-reviewer",
        findings: [reviewed, reviewed],
      })
    ).status >= 400,
  )
  const reviewBody = { reviewedBy: "independent-reviewer", findings: [reviewed] }
  const accepted = await api("POST", "/findings-proof/findings", reviewBody)
  const exact = await api("POST", "/findings-proof/findings", reviewBody)
  await check(
    "reviewed evidence-backed finding accepted and exact retry is no-op",
    accepted.status === 200 && exact.body.operation.revision === accepted.body.operation.revision,
  )
  const rendered = await api("POST", "/findings-proof/report", {})
  await check(
    "reviewed synthetic finding reaches actual PDF and completion",
    rendered.status === 200 &&
      rendered.body.report?.pdfRendered === true &&
      rendered.body.operation?.goal.status === "complete",
    { status: rendered.status },
  )
  const changed = await api("POST", "/findings-proof/findings", {
    reviewedBy: "independent-reviewer",
    findings: [
      { ...reviewed, description: `${reviewed.description} Reviewed source wording changed after completion.` },
    ],
  })
  await check(
    "post-completion source change rejects or immediately reopens goal",
    changed.status >= 400 || changed.body.operation.goal.status !== "complete",
    {
      status: changed.status,
      goalStatus: changed.body.operation?.goal.status,
      auditPresent: Boolean(changed.body.operation?.audit),
    },
  )
  const staleLint = await api("GET", "/findings-proof/lint")
  await check("source change invalidates old final lint", changed.status >= 400 || staleLint.body.ok === false)
  const rerender = await api("POST", "/findings-proof/report", {})
  await check(
    "source-driven rerender restores actual package",
    rerender.status === 200 && rerender.body.operation.goal.status === "complete",
  )
  const negative = await api("POST", "", {
    id: "immutable-source",
    sessionID: "immutable-session",
    objective: "Check source immutability without corrupting the report fixture",
    scope: { targets: [target], mode: "synthetic_lab" },
  })
  if (negative.status !== 201) throw new Error("Negative operation failed")
  await mkdir(`${workspace}/.ulmcode/operations/immutable-source/evidence`, { recursive: true })
  const immutable = `${workspace}/.ulmcode/operations/immutable-source/evidence/source.txt`
  await Bun.write(immutable, "Original synthetic source")
  await api("POST", "/immutable-source/artifacts", { artifacts: [{ path: "evidence/source.txt" }] })
  await Bun.write(immutable, "Changed synthetic source")
  await check(
    "changed registered source bytes conflict",
    (await api("POST", "/immutable-source/artifacts", { artifacts: [{ path: "evidence/source.txt" }] })).status === 409,
  )
  const immutableBefore = await api("GET", "/immutable-source")
  const tamperedNormalization = await api("POST", "/immutable-source/normalize", {})
  const immutableAfter = await api("GET", "/immutable-source")
  await check(
    "normalizer rejects altered registered source before projection writes",
    tamperedNormalization.status >= 400 &&
      !(await Bun.file(`${workspace}/.ulmcode/operations/immutable-source/evidence/normalized.json`).exists()) &&
      immutableBefore.body.operation.revision === immutableAfter.body.operation.revision,
    { status: tamperedNormalization.status },
  )
  for (const mode of ["tamper", "missing", "unregistered"]) {
    const id = `findings-${mode}`
    await api("POST", "", {
      id,
      sessionID: `session-${id}`,
      objective: "Reject canonical finding file adoption outside its registered source hash",
      scope: { targets: [target], mode: "synthetic_lab" },
    })
    const directory = `${workspace}/.ulmcode/operations/${id}/findings`
    const file = `${directory}/findings.json`
    const candidate = { ...finding, evidenceIDs: [] }
    if (mode === "unregistered") {
      await mkdir(directory, { recursive: true })
      await Bun.write(file, JSON.stringify({ operationID: id, findings: [{ ...candidate, state: "rejected" }] }))
    } else {
      await api("POST", `/${id}/findings`, { findings: [candidate] })
      if (mode === "missing") await unlink(file)
      else {
        const document = await Bun.file(file).json()
        document.findings[0].state = "rejected"
        await Bun.write(file, JSON.stringify(document))
      }
    }
    const adoption = await api("POST", `/${id}/findings`, { findings: [] })
    await check(`canonical findings ${mode} cannot be adopted by an empty collection`, adoption.status >= 400, {
      status: adoption.status,
    })
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1
} finally {
  host.kill("SIGTERM")
  const timer = setTimeout(() => host.kill("SIGKILL"), 5000)
  await host.exited
  clearTimeout(timer)
  lab.stop(true)
}
