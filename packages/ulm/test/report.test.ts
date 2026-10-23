import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "bun:test"
import type { NormalizedEvidence, OperationRecord } from "../src/operation"
import { lintReport, renderReport } from "../src/report"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("renders an evidence-backed synthetic operation and lints the registered package", async () => {
  const operationDirectory = await mkdtemp(path.join(os.tmpdir(), "ulm-report-"))
  directories.push(operationDirectory)
  await mkdir(path.join(operationDirectory, "lab"), { recursive: true })
  await mkdir(path.join(operationDirectory, "evidence"), { recursive: true })
  await mkdir(path.join(operationDirectory, "findings"), { recursive: true })
  const sourceBytes = Buffer.from(
    JSON.stringify({
      lab: "synthetic-local-web",
      observations: [{ kind: "http", summary: "Synthetic lab returned its local health response." }],
    }),
  )
  await writeFile(path.join(operationDirectory, "lab", "health.json"), sourceBytes)
  const source = {
    path: "lab/health.json",
    mediaType: "application/json",
    sha256: hash(sourceBytes),
    size: sourceBytes.byteLength,
  }
  const evidence: NormalizedEvidence = {
    operationID: "synthetic-report",
    normalizedAt: "2026-10-23T00:00:00.000Z",
    normalizerVersion: "ulm-evidence-v1",
    // A repeated normalization can carry the previous projection as an input
    // artifact. Its old hash is expected to be stale after this file is replaced.
    artifacts: [
      source,
      { path: "evidence/normalized.json", mediaType: "application/json", sha256: "f".repeat(64), size: 1 },
    ],
    claims: [
      {
        id: "claim-health-1",
        kind: "http",
        subject: "localhost synthetic lab",
        summary: "Synthetic lab returned its local health response.",
        confidence: 1,
        source,
      },
    ],
    limitations: [],
  }
  const normalizedBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`)
  await writeFile(path.join(operationDirectory, "evidence", "normalized.json"), normalizedBytes)
  const findingFile = Buffer.from(
    `${JSON.stringify(
      {
        operationID: "synthetic-report",
        findings: [
          {
            id: "F-LOCAL-1",
            title: "<script>escaped report title</script>",
            state: "report_ready",
            severity: "low",
            confidence: 1,
            description:
              "A synthetic verification finding with password=do-not-print retained only as a sanitizer canary.",
            impact: "Synthetic lab only.",
            remediation: "Remove the local test marker after validating the report pipeline.",
            affectedAssets: ["https://tester:secret@lab.invalid/?token=private"],
            evidenceIDs: ["claim-health-1"],
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(path.join(operationDirectory, "findings", "findings.json"), findingFile)
  const operation: OperationRecord = {
    schemaVersion: 1,
    id: "synthetic-report",
    revision: 7,
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    status: "blocked",
    objective: "Produce an evidence-backed synthetic report <without executable markup>.",
    sessionIDs: ["session-report-test"],
    scope: { mode: "synthetic_lab", targets: ["https://tester:secret@lab.invalid/?token=private"] },
    plan: {
      version: 1,
      approvedAt: "2026-10-23T00:00:00.000Z",
      approvedBy: "test operator",
      assumptions: ["The local synthetic fixture is the entire scope."],
      successCriteria: ["Preserve evidence links and render a reviewable handoff."],
      phases: [
        {
          id: "verify-local-lab",
          title: "Verify the local synthetic lab",
          dependsOn: [],
          successCriteria: ["Record the synthetic health response."],
          status: "complete",
          restart: "safe",
          required: true,
          expectedArtifacts: ["lab/health.json"],
        },
      ],
      reporting: { required: true, renderer: "ulmcode-report-v1" },
    },
    goal: {
      status: "active",
      startedAt: "2026-10-23T00:00:00.000Z",
      continuation: { enabled: true, maxNoToolTurns: 2, noToolStreak: 0 },
      gates: [],
    },
    executions: [
      {
        id: "exec-local-health",
        phaseID: "verify-local-lab",
        adapter: "loopback-lab-v1",
        idempotencyKey: "exec-local-health:1",
        status: "succeeded",
        attempt: 1,
        createdAt: "2026-10-23T00:00:00.000Z",
        startedAt: "2026-10-23T00:00:01.000Z",
        updatedAt: "2026-10-23T00:00:02.000Z",
        endedAt: "2026-10-23T00:00:02.000Z",
        artifactRefs: [source],
        errorSummary: "token=private /home/trevor/private.log",
      },
    ],
    artifacts: [
      {
        path: "evidence/normalized.json",
        mediaType: "application/json",
        sha256: hash(normalizedBytes),
        size: normalizedBytes.byteLength,
      },
      {
        path: "findings/findings.json",
        mediaType: "application/json",
        sha256: hash(findingFile),
        size: findingFile.byteLength,
      },
    ],
    evidence,
    handoffs: [],
  }
  const chromiumPath = await findChromium()
  const rendered = await renderReport({
    operation,
    operationDirectory,
    chromiumPath,
    generatedAt: "2026-10-23T00:01:00.000Z",
  })
  expect(rendered.pdfRendered).toBe(chromiumPath !== undefined)
  expect(rendered.artifacts.map((artifact) => artifact.path).sort()).toEqual(
    [
      "deliverables/final/manifest.json",
      ...(chromiumPath ? ["deliverables/final/report.pdf"] : []),
      "deliverables/final/report.html",
      "deliverables/final/runtime-summary.json",
    ].sort(),
  )
  const html = await readFile(rendered.html, "utf8")
  expect(html).toContain("&lt;script&gt;escaped report title&lt;/script&gt;")
  expect(html).not.toContain("<script>escaped report title</script>")
  expect(html).toContain("[REDACTED]@lab.invalid/?token=[REDACTED]")
  expect(html).toContain("claim-health-1")
  expect(html).toContain("Recommended remediation")
  expect(html).toContain("Collection status <strong>Collection complete</strong>")
  expect(html).not.toContain("Collection status <strong>blocked</strong>")
  expect(html).toContain("<strong>Recorded operation state at render:</strong> blocked")
  expect(html).not.toContain("password=do-not-print")
  const runtime = await readFile(rendered.runtimeSummary, "utf8")
  expect(runtime).not.toContain("token=private")
  expect(runtime).not.toContain("/home/trevor/private.log")

  if (chromiumPath) {
    const pdf = await readFile(rendered.pdf!)
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
  }
  const manifest = JSON.parse(await readFile(rendered.manifestPath, "utf8")) as {
    files: Array<{ path: string; sha256: string }>
  }
  expect(manifest.files.map((entry) => entry.path).sort()).toEqual(
    [
      "deliverables/final/report.html",
      ...(chromiumPath ? ["deliverables/final/report.pdf"] : []),
      "deliverables/final/runtime-summary.json",
    ].sort(),
  )

  const finalOperation: OperationRecord = {
    ...operation,
    revision: 9,
    reportSourceRevision: rendered.manifest.sourceRevision,
    reportSourceDigest: rendered.manifest.sourceDigest,
    artifacts: [...operation.artifacts, ...rendered.artifacts],
    audit: { status: "passed", checkedAt: "2026-10-23T00:02:00.000Z", blockers: [], recordRevision: 9 },
  }
  const lint = await lintReport({ operation: finalOperation, operationDirectory })
  expect(lint.ok).toBe(chromiumPath !== undefined)
  if (!chromiumPath) expect(lint.blockers.join(" ")).toContain("exact report package")
  else expect(lint.blockers).toEqual([])

  if (chromiumPath) {
    const pdf = await readFile(rendered.pdf!)
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")

    await writeFile(rendered.html, "<!doctype html><html><body>NOT A REAL REPORT</body></html>")
    await writeFile(rendered.pdf!, "%PDF-1.7\nNOT A REAL PDF\n%%EOF\n")
    await writeFile(rendered.runtimeSummary, "{}\n")
    const forgedFiles = await Promise.all(
      [rendered.html, rendered.pdf!, rendered.runtimeSummary].map(async (filePath) => {
        const bytes = await readFile(filePath)
        return {
          path: path.relative(operationDirectory, filePath).split(path.sep).join("/"),
          sha256: hash(bytes),
        }
      }),
    )
    await writeFile(rendered.manifestPath, `${JSON.stringify({ ...manifest, files: forgedFiles }, null, 2)}\n`)
    const registeredPaths = await Promise.all(
      [...forgedFiles.map((file) => file.path), "deliverables/final/manifest.json"].map(async (filePath) => ({
        path: filePath,
        mediaType: filePath.endsWith(".pdf") ? "application/pdf" : filePath.endsWith(".html") ? "text/html" : "application/json",
        sha256: hash(await readFile(path.join(operationDirectory, filePath))),
      })),
    )
    const forgedOperation: OperationRecord = {
      ...finalOperation,
      audit: undefined,
      artifacts: [
        ...finalOperation.artifacts.filter((artifact) => !artifact.path.startsWith("deliverables/final/")),
        ...registeredPaths,
      ],
    }
    const forged = await lintReport({ operation: forgedOperation, operationDirectory, requireAudit: false })
    expect(forged.ok).toBe(false)
    expect(forged.blockers.some((blocker) => blocker.includes("styled report structure"))).toBe(true)
    expect(forged.blockers.some((blocker) => blocker.includes("structurally valid paginated PDF"))).toBe(true)
    expect(forged.blockers.some((blocker) => blocker.includes("runtime summary execution count"))).toBe(true)

    await writeFile(rendered.html, `${html}\n<!-- tampered after manifest -->`)
    const stale = await lintReport({ operation: finalOperation, operationDirectory })
    expect(stale.ok).toBe(false)
    expect(stale.blockers.some((blocker) => blocker.includes("sha256"))).toBe(true)
  }

  const findingCandidateBytes = Buffer.from(findingFile.toString().replace('"state": "report_ready"', '"state": "needs_validation"'))
  await writeFile(path.join(operationDirectory, "findings", "findings.json"), findingCandidateBytes)
  const findingRef = operation.artifacts.find((artifact) => artifact.path === "findings/findings.json")!
  const candidateOperation: OperationRecord = {
    ...operation,
    revision: operation.revision + 1,
    artifacts: operation.artifacts.map((artifact) =>
      artifact.path === "findings/findings.json"
        ? { ...findingRef, sha256: hash(findingCandidateBytes), size: findingCandidateBytes.byteLength }
        : artifact,
    ),
  }
  const candidateReport = await renderReport({ operation: candidateOperation, operationDirectory, chromiumPath })
  const candidateFinalOperation: OperationRecord = {
    ...candidateOperation,
    revision: candidateOperation.revision + 2,
    reportSourceRevision: candidateReport.manifest.sourceRevision,
    reportSourceDigest: candidateReport.manifest.sourceDigest,
    artifacts: [...candidateOperation.artifacts, ...candidateReport.artifacts],
    audit: {
      status: "passed",
      checkedAt: "2026-10-23T00:03:00.000Z",
      blockers: [],
      recordRevision: candidateOperation.revision + 2,
    },
  }
  const unresolved = await lintReport({ operation: candidateFinalOperation, operationDirectory, requireAudit: false })
  expect(unresolved.ok).toBe(false)
  expect(unresolved.blockers).toContain("finding F-LOCAL-1 remains unresolved in state needs_validation")

  const duplicateFindingBytes = Buffer.from(
    JSON.stringify(
      { operationID: operation.id, findings: Array(2).fill(JSON.parse(findingFile.toString()).findings[0]) },
      null,
      2,
    ) + "\n",
  )
  await writeFile(path.join(operationDirectory, "findings", "findings.json"), duplicateFindingBytes)
  const duplicateOperation: OperationRecord = {
    ...candidateOperation,
    artifacts: candidateOperation.artifacts.map((artifact) =>
      artifact.path === "findings/findings.json"
        ? { ...findingRef, sha256: hash(duplicateFindingBytes), size: duplicateFindingBytes.byteLength }
        : artifact,
    ),
  }
  await expect(renderReport({ operation: duplicateOperation, operationDirectory, chromiumPath })).rejects.toThrow(
    "findings artifact contains duplicate id F-LOCAL-1",
  )
})

function hash(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

async function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter((candidate): candidate is string => Boolean(candidate))
  const cache = path.join(process.env.HOME ?? "", ".cache", "ms-playwright")
  const versions = await readdir(cache).catch(() => [])
  candidates.push(
    ...versions
      .filter((version) => /^chromium-\d+$/.test(version))
      .map((version) => path.join(cache, version, "chrome-linux64", "chrome")),
  )
  for (const candidate of candidates) if (await Bun.file(candidate).exists()) return candidate
  return undefined
}
