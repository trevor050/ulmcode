import { createHash } from "node:crypto"
import { mkdir, readFile, realpath, readdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  operationSourceDigest,
  type ArtifactRef,
  type EvidenceClaim,
  type NormalizedEvidence,
  type OperationRecord,
} from "./operation"

const FINAL_DIRECTORY = path.join("deliverables", "final")
const FINAL_FILES = ["report.html", "report.pdf", "runtime-summary.json"] as const
const REPORTABLE_STATES = new Set(["validated", "report_ready"])
const DISPOSITIONED_STATES = new Set(["rejected"])

type ReportFinding = {
  id: string
  title: string
  state: "validated" | "report_ready"
  severity: string
  confidence?: number
  description: string
  impact?: string
  remediation?: string
  affectedAssets: string[]
  evidenceIDs: string[]
}

type ReportFindingSource = { operationID: string; findings: ReportFinding[] }

export type RenderReportInput = {
  operation: OperationRecord
  operationDirectory: string
  chromiumPath?: string
  generatedAt?: string
}

export type RenderReportResult = {
  operationID: string
  directory: string
  html: string
  pdf?: string
  artifacts: ArtifactRef[]
  runtimeSummary: string
  manifestPath: string
  manifest: ReportManifest
  pdfRendered: boolean
  pdfError?: string
  sourceDigest: string
  counts: { findings: number; evidence: number; executions: number }
}

export type ReportManifest = {
  operationID: string
  sourceRevision: number
  sourceDigest: string
  files: Array<{ path: string; sha256: string }>
}

export type LintReportResult = {
  operationID: string
  ok: boolean
  gaps: string[]
  blockers: string[]
  sourceDigest?: string
  manifest?: string
  audit?: { status: string; recordRevision: number; operationRevision: number }
}

/** Render a self-contained HTML report from durable operation, evidence, and finding artifacts. */
export async function renderReport(input: RenderReportInput): Promise<RenderReportResult> {
  const operation = input.operation
  const operationDirectory = path.resolve(input.operationDirectory)
  const finalDirectory = path.join(operationDirectory, FINAL_DIRECTORY)
  await mkdir(finalDirectory, { recursive: true })

  const evidence = await readNormalizedEvidence(operationDirectory, operation)
  await verifyEvidenceSources(operationDirectory, evidence)
  const findingResult = await readFindings(operationDirectory, operation)
  const findings = findingResult.findings
  const runtimeSummary = createRuntimeSummary(operation, input.generatedAt ?? new Date().toISOString())
  const sourceDigest = operationSourceDigest(operation)
  const reportHTML = renderHTML({
    operation,
    evidence,
    findings,
    runtimeSummary,
    sourceDigest,
    generatedAt: runtimeSummary.generatedAt,
  })
  const htmlPath = path.join(finalDirectory, "report.html")
  const pdfPath = path.join(finalDirectory, "report.pdf")
  const runtimeSummaryPath = path.join(finalDirectory, "runtime-summary.json")
  const manifestPath = path.join(finalDirectory, "manifest.json")

  await writeFile(htmlPath, reportHTML, { mode: 0o600 })
  await writeFile(runtimeSummaryPath, `${JSON.stringify(runtimeSummary, null, 2)}\n`, { mode: 0o600 })

  await unlink(pdfPath).catch(() => undefined)
  const browser = input.chromiumPath ?? (await discoverChromium())
  const pdfResult = browser
    ? await renderPDF(browser, htmlPath, pdfPath)
    : { ok: false as const, error: "Chromium was not found; HTML was written and PDF rendering was not attempted." }
  if (!pdfResult.ok) await unlink(pdfPath).catch(() => undefined)
  const artifacts = await Promise.all(
    [htmlPath, runtimeSummaryPath, ...(pdfResult.ok ? [pdfPath] : [])].map(async (filePath) => {
      const content = await readFile(filePath)
      return {
        path: path.relative(operationDirectory, filePath).split(path.sep).join("/"),
        mediaType: filePath.endsWith(".pdf")
          ? "application/pdf"
          : filePath.endsWith(".html")
            ? "text/html"
            : "application/json",
        sha256: digest(content),
        size: content.byteLength,
      }
    }),
  )
  const manifest: ReportManifest = {
    operationID: operation.id,
    sourceRevision: operation.revision,
    sourceDigest,
    files: artifacts.map((artifact) => ({ path: artifact.path, sha256: artifact.sha256 ?? "" })),
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, generatedAt: runtimeSummary.generatedAt, render: { html: "complete", pdf: pdfResult.ok ? "complete" : "failed", pdfError: pdfResult.ok ? undefined : sanitizeText(pdfResult.error) }, counts: { findings: findings.length, evidence: evidence?.claims.length ?? 0, executions: operation.executions.length } }, null, 2)}\n`,
    { mode: 0o600 },
  )
  const manifestBytes = await readFile(manifestPath)
  artifacts.push({
    path: path.relative(operationDirectory, manifestPath).split(path.sep).join("/"),
    mediaType: "application/json",
    sha256: digest(manifestBytes),
    size: manifestBytes.byteLength,
  })

  return {
    operationID: operation.id,
    directory: finalDirectory,
    html: htmlPath,
    pdf: pdfResult.ok ? pdfPath : undefined,
    artifacts,
    runtimeSummary: runtimeSummaryPath,
    manifestPath,
    manifest,
    pdfRendered: pdfResult.ok,
    pdfError: pdfResult.ok ? undefined : sanitizeText(pdfResult.error),
    sourceDigest,
    counts: {
      findings: findings.length,
      evidence: evidence?.claims.length ?? 0,
      executions: operation.executions.length,
    },
  }
}

/** Check exact package contents, artifact hashes, source digest, and the current operation audit. */
export async function lintReport(
  input: Pick<RenderReportInput, "operation" | "operationDirectory"> & { requireAudit?: boolean },
): Promise<LintReportResult> {
  const operation = input.operation
  const finalDirectory = path.join(path.resolve(input.operationDirectory), FINAL_DIRECTORY)
  const gaps: string[] = []
  const manifestPath = path.join(finalDirectory, "manifest.json")
  let manifest: Record<string, unknown> | undefined
  try {
    manifest = JSON.parse(
      (await readOperationFile(path.resolve(input.operationDirectory), `${FINAL_DIRECTORY}/manifest.json`)).toString(),
    ) as Record<string, unknown>
  } catch {
    const blockers = ["deliverables/final/manifest.json is missing or invalid JSON"]
    return { operationID: operation.id, ok: false, gaps: blockers, blockers }
  }

  if (manifest.operationID !== operation.id) gaps.push("manifest operationID does not match the operation")
  if (typeof manifest.sourceRevision !== "number" || !Number.isInteger(manifest.sourceRevision))
    gaps.push("manifest sourceRevision is invalid")
  if (typeof manifest.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(manifest.sourceDigest))
    gaps.push("manifest sourceDigest is invalid")
  if (typeof manifest.generatedAt !== "string" || !Number.isFinite(Date.parse(manifest.generatedAt)))
    gaps.push("manifest generatedAt is invalid")
  const render = isRecord(manifest.render) ? manifest.render : undefined
  if (render?.html !== "complete") gaps.push("manifest does not confirm a complete HTML render")
  if (render?.pdf !== "complete") gaps.push("manifest does not confirm a complete PDF render")
  const entries = await readdir(finalDirectory, { withFileTypes: true }).catch(() => [])
  const actualFiles = entries.map((entry) => entry.name).sort()
  const expectedActualFiles = [...FINAL_FILES, "manifest.json"].sort()
  if (!sameStrings(actualFiles, expectedActualFiles) || entries.some((entry) => !entry.isFile()))
    gaps.push("final directory contents do not match the exact report package")

  const files = Array.isArray(manifest.files) ? manifest.files : []
  const artifactMap = new Map<string, { path: string; sha256: string }>()
  for (const value of files) {
    if (!isRecord(value) || typeof value.path !== "string" || typeof value.sha256 !== "string") {
      gaps.push("manifest contains an invalid file entry")
      continue
    }
    const relative = path.relative(
      path.resolve(input.operationDirectory),
      path.resolve(input.operationDirectory, value.path),
    )
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.split(path.sep).join("/") !== value.path
    ) {
      gaps.push(`manifest artifact path is unsafe: ${value.path}`)
      continue
    }
    artifactMap.set(value.path, { path: value.path, sha256: value.sha256 })
  }
  const expectedArtifactPaths = FINAL_FILES.map((name) => `deliverables/final/${name}`).sort()
  if (
    files.length !== FINAL_FILES.length ||
    artifactMap.size !== files.length ||
    !sameStrings([...artifactMap.keys()].sort(), expectedArtifactPaths)
  ) {
    gaps.push("manifest file paths do not match the exact final package contract")
  }
  for (const [name, entry] of artifactMap) {
    try {
      const content = await readOperationFile(input.operationDirectory, name)
      if (digest(content) !== entry.sha256) gaps.push(`${name} sha256 does not match manifest`)
    } catch {
      gaps.push(`${name} is missing`)
    }
  }
  const recordedFinalFiles = operation.artifacts.filter((artifact) => artifact.path.startsWith("deliverables/final/"))
  const recordedPaths = recordedFinalFiles.map((artifact) => artifact.path).sort()
  const exactFinalPaths = [...FINAL_FILES, "manifest.json"].map((name) => `deliverables/final/${name}`).sort()
  if (!sameStrings(recordedPaths, exactFinalPaths))
    gaps.push("operation snapshot does not register the exact final report package")
  for (const artifact of recordedFinalFiles) {
    try {
      if (
        !artifact.sha256 ||
        digest(await readOperationFile(input.operationDirectory, artifact.path)) !== artifact.sha256
      ) {
        gaps.push(`${artifact.path} does not match its operation artifact reference`)
      }
    } catch {
      gaps.push(`${artifact.path} is missing from the registered operation package`)
    }
  }

  const evidence = await readNormalizedEvidence(path.resolve(input.operationDirectory), operation).catch((error) => {
    gaps.push(`normalized evidence is invalid: ${message(error)}`)
    return undefined
  })
  await verifyEvidenceSources(path.resolve(input.operationDirectory), evidence).catch((error) =>
    gaps.push(`evidence source verification failed: ${message(error)}`),
  )
  const findingResult = await readFindings(path.resolve(input.operationDirectory), operation).catch((error) => {
    gaps.push(`findings artifact is invalid: ${message(error)}`)
    return { findings: [], unresolved: [] }
  })
  const findings = findingResult.findings
  for (const candidate of findingResult.unresolved)
    gaps.push(`finding ${candidate.id} remains unresolved in state ${candidate.state}`)
  const evidenceIDs = new Set(evidence?.claims.map((claim) => claim.id) ?? [])
  for (const finding of findings) {
    if (!finding.evidenceIDs.length) gaps.push(`finding ${finding.id} has no evidence references`)
    for (const id of finding.evidenceIDs)
      if (!evidenceIDs.has(id)) gaps.push(`finding ${finding.id} references missing evidence ${id}`)
  }
  let runtimeSummary: ReturnType<typeof createRuntimeSummary> | undefined
  try {
    runtimeSummary = JSON.parse(
      (
        await readOperationFile(path.resolve(input.operationDirectory), `${FINAL_DIRECTORY}/runtime-summary.json`)
      ).toString(),
    ) as ReturnType<typeof createRuntimeSummary>
    if (runtimeSummary.operationID !== operation.id)
      gaps.push("runtime summary operationID does not match the operation")
    if (runtimeSummary.schemaVersion !== 1)
      gaps.push("runtime summary schemaVersion is invalid")
    if (runtimeSummary.generatedFromRevision !== manifest.sourceRevision)
      gaps.push("runtime summary source revision does not match the manifest")
    if (!Array.isArray(runtimeSummary.executions) || runtimeSummary.executions.length !== operation.executions.length)
      gaps.push("runtime summary execution count does not match the operation")
    else if (
      runtimeSummary.executions.some((item, index) => {
        const execution = operation.executions[index]
        return !execution || item.id !== execution.id || item.status !== execution.status || item.phaseID !== execution.phaseID
      })
    ) {
      gaps.push("runtime summary executions do not match the operation snapshot")
    }
    if (runtimeSummary.evidenceCount !== (operation.evidence?.claims.length ?? 0))
      gaps.push("runtime summary evidence count does not match the operation")
    if (runtimeSummary.artifactCount !== operation.artifacts.filter((artifact) => !artifact.path.startsWith("deliverables/final/")).length)
      gaps.push("runtime summary artifact count does not match the operation")
    if (!Array.isArray(runtimeSummary.limitations) || typeof runtimeSummary.status !== "string")
      gaps.push("runtime summary is missing status or limitations")
  } catch {
    gaps.push("runtime-summary.json is missing or invalid JSON")
  }

  try {
    const html = (await readOperationFile(path.resolve(input.operationDirectory), `${FINAL_DIRECTORY}/report.html`)).toString()
    const normalizedHTML = html.toLowerCase()
    const requiredHTML = [
      "<!doctype html>",
      '<html lang="en">',
      "<style>",
      "<main>",
      "</main>",
      "scope and method",
      "validated findings",
      "evidence register",
      "recorded execution",
      "remediation and next steps",
      "runtime summary and limitations",
    ]
    if (requiredHTML.some((token) => !normalizedHTML.includes(token)))
      gaps.push("report.html is missing required styled report structure")
    if (!html.includes(escapeHTML(operation.id)) || !html.includes(String(manifest.sourceDigest)))
      gaps.push("report.html does not identify the operation and source digest")
    if (!html.includes(`Source revision <strong>${manifest.sourceRevision}</strong>`))
      gaps.push("report.html does not identify the source revision")
    for (const finding of findings) {
      if (!html.includes(escapeHTML(finding.id)) || !html.includes(escapeHTML(finding.title)))
        gaps.push(`report.html omits validated finding ${finding.id}`)
      for (const evidenceID of finding.evidenceIDs)
        if (!html.includes(escapeHTML(evidenceID))) gaps.push(`report.html omits finding evidence ${evidenceID}`)
    }
    if (html.length < 1_000) gaps.push("report.html is too short to contain the required report sections")
  } catch {
    gaps.push("report.html is missing or unreadable")
  }

  try {
    const pdf = await readOperationFile(path.resolve(input.operationDirectory), `${FINAL_DIRECTORY}/report.pdf`)
    const pdfText = pdf.toString("latin1")
    const pages = pdfText.match(/\/Type\s*\/Page\b/g) ?? []
    if (
      !pdfText.startsWith("%PDF-") ||
      !pdfText.trimEnd().endsWith("%%EOF") ||
      !/\/Root\s+\d+\s+\d+\s+R/.test(pdfText) ||
      !/\/Type\s*\/Pages\b/.test(pdfText) ||
      !/\/MediaBox\s*\[/.test(pdfText) ||
      !/\/Contents\s+\d+\s+\d+\s+R/.test(pdfText) ||
      pages.length === 0
    ) {
      gaps.push("report.pdf is not a structurally valid paginated PDF")
    }
    const pdfinfo = Bun.which("pdfinfo")
    if (pdfinfo) {
      const process = Bun.spawn(
        [pdfinfo, path.join(finalDirectory, "report.pdf")],
        { stdout: "pipe", stderr: "ignore" },
      )
      const [exitCode, details] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
      ])
      const pageCount = Number(details.match(/^Pages:\s+(\d+)\s*$/m)?.[1] ?? 0)
      if (exitCode !== 0 || pageCount < 1)
        gaps.push("report.pdf could not be parsed as a paginated PDF")
    }
  } catch {
    gaps.push("report.pdf is missing or unreadable")
  }

  const sourceDigest = operationSourceDigest(operation)
  if (typeof manifest.sourceDigest !== "string" || manifest.sourceDigest !== sourceDigest) {
    gaps.push("manifest sourceDigest does not match the current operation source snapshot")
  }
  if (manifest.sourceRevision !== operation.reportSourceRevision)
    gaps.push("manifest sourceRevision does not match the operation's registered report source revision")
  if (manifest.sourceDigest !== operation.reportSourceDigest)
    gaps.push("manifest sourceDigest does not match the operation's registered report source digest")
  const audit = operation.audit
  if (input.requireAudit !== false) {
    if (!audit || audit.status !== "passed") gaps.push("operation audit has not passed")
    if (audit && audit.recordRevision !== operation.revision)
      gaps.push("operation audit is stale for the current operation revision")
  }
  return {
    operationID: operation.id,
    ok: gaps.length === 0,
    gaps,
    blockers: gaps,
    sourceDigest,
    manifest: manifestPath,
    audit: audit
      ? { status: audit.status, recordRevision: audit.recordRevision, operationRevision: operation.revision }
      : undefined,
  }
}

function createRuntimeSummary(operation: OperationRecord, generatedAt: string) {
  return {
    schemaVersion: 1,
    operationID: operation.id,
    generatedAt,
    generatedFromRevision: operation.revision,
    status: operation.status,
    executions: operation.executions.map((execution) => ({
      id: execution.id,
      phaseID: execution.phaseID,
      adapter: execution.adapter,
      status: execution.status,
      attempt: execution.attempt,
      createdAt: execution.createdAt,
      startedAt: execution.startedAt ?? null,
      endedAt: execution.endedAt ?? null,
      artifactCount: execution.artifactRefs.length,
      errorSummary: execution.errorSummary ? sanitizeText(execution.errorSummary) : null,
    })),
    artifactCount: operation.artifacts.filter((artifact) => !artifact.path.startsWith("deliverables/final/")).length,
    evidenceCount: operation.evidence?.claims.length ?? 0,
    audit: operation.audit
      ? {
          status: operation.audit.status,
          checkedAt: operation.audit.checkedAt,
          recordRevision: operation.audit.recordRevision,
        }
      : null,
    limitations: operation.evidence?.limitations.map(sanitizeText) ?? [],
  }
}

async function readNormalizedEvidence(
  directory: string,
  operation: OperationRecord,
): Promise<NormalizedEvidence | undefined> {
  let evidence = operation.evidence
  let bytes: Buffer
  try {
    bytes = await readOperationFile(directory, "evidence/normalized.json")
  } catch (error) {
    const hasEvidenceRef = operation.artifacts.some((artifact) => artifact.path === "evidence/normalized.json")
    if (error instanceof Error && "code" in error && error.code === "ENOENT" && !evidence && !hasEvidenceRef)
      return undefined
    throw new Error(`evidence/normalized.json is missing or unreadable: ${message(error)}`)
  }
  const sourceRef = operation.artifacts.find((artifact) => artifact.path === "evidence/normalized.json")
  if (!sourceRef?.sha256 || digest(bytes) !== sourceRef.sha256)
    throw new Error("evidence/normalized.json is not registered by hash in the operation snapshot")
  try {
    const parsed = JSON.parse(bytes.toString()) as NormalizedEvidence
    if (parsed.operationID !== operation.id || !Array.isArray(parsed.claims) || !Array.isArray(parsed.artifacts)) {
      throw new Error("evidence/normalized.json does not match the operation evidence schema")
    }
    if (evidence && digest(parsed) !== digest(evidence))
      throw new Error("normalized evidence file differs from the operation snapshot")
    evidence = parsed
  } catch (error) {
    throw new Error(`evidence/normalized.json is invalid: ${message(error)}`)
  }
  if (evidence && evidence.operationID !== operation.id)
    throw new Error("normalized evidence operationID does not match the operation")
  return evidence
}

async function verifyEvidenceSources(directory: string, evidence: NormalizedEvidence | undefined) {
  if (!evidence) return
  const operationRoot = await realpath(directory)
  // The normalized document is a derived projection. Re-normalizing may replace it,
  // so it cannot also be treated as immutable raw evidence from a previous pass.
  const sources = [...evidence.artifacts, ...evidence.claims.map((claim) => claim.source)].filter(
    (item) => item.path !== "evidence/normalized.json",
  )
  for (const source of new Map(sources.map((item) => [item.path, item])).values()) {
    if (!source.sha256 || path.isAbsolute(source.path) || /^[A-Za-z]:[\\/]/.test(source.path))
      throw new Error(`evidence source is not safely hashed: ${source.path}`)
    const target = path.resolve(operationRoot, source.path)
    const relative = path.relative(operationRoot, target)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`evidence source escapes the operation: ${source.path}`)
    const actual = await realpath(target)
    const actualRelative = path.relative(operationRoot, actual)
    if (!actualRelative || actualRelative.startsWith("..") || path.isAbsolute(actualRelative))
      throw new Error(`evidence source resolves outside the operation: ${source.path}`)
    if (digest(await readFile(actual)) !== source.sha256)
      throw new Error(`evidence source hash does not match: ${source.path}`)
  }
}

async function readFindings(
  directory: string,
  operation: OperationRecord,
): Promise<{ findings: ReportFinding[]; unresolved: Array<{ id: string; state: string }> }> {
  try {
    const bytes = await readOperationFile(directory, "findings/findings.json")
    const sourceRef = operation.artifacts.find((artifact) => artifact.path === "findings/findings.json")
    if (!sourceRef?.sha256 || sourceRef.sha256 !== digest(bytes))
      throw new Error("findings/findings.json is not registered by hash in the operation snapshot")
    const parsed = JSON.parse(bytes.toString()) as ReportFindingSource
    if (parsed.operationID !== operation.id || !Array.isArray(parsed.findings))
      throw new Error("findings/findings.json does not match the operation schema")
    const seenIDs = new Set<string>()
    const unresolved: Array<{ id: string; state: string }> = []
    const findings = parsed.findings.flatMap((finding) => {
      if (
        !isRecord(finding) ||
        typeof finding.id !== "string" ||
        typeof finding.title !== "string" ||
        typeof finding.state !== "string"
      ) {
        throw new Error("finding record is missing an id, title, or state")
      }
      if (seenIDs.has(finding.id)) throw new Error(`findings artifact contains duplicate id ${finding.id}`)
      seenIDs.add(finding.id)
      if (!REPORTABLE_STATES.has(finding.state)) {
        if (!DISPOSITIONED_STATES.has(finding.state)) unresolved.push({ id: finding.id, state: finding.state })
        return []
      }
      if (
        typeof finding.severity !== "string" ||
        typeof finding.description !== "string" ||
        !Array.isArray(finding.evidenceIDs)
      ) {
        throw new Error(`reportable finding ${finding.id} is missing severity, description, or evidence references`)
      }
      return [
        {
          id: finding.id,
          title: finding.title,
          state: finding.state as ReportFinding["state"],
          severity: finding.severity,
          confidence: typeof finding.confidence === "number" ? finding.confidence : undefined,
          description: finding.description,
          impact: typeof finding.impact === "string" ? finding.impact : undefined,
          remediation: typeof finding.remediation === "string" ? finding.remediation : undefined,
          affectedAssets: stringArray(finding.affectedAssets),
          evidenceIDs: stringArray(finding.evidenceIDs),
        },
      ]
    })
    return { findings, unresolved }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { findings: [], unresolved: [] }
    throw error
  }
}

async function readOperationFile(directory: string, relativePath: string) {
  if (path.isAbsolute(relativePath)) throw new Error("operation artifact path must be relative")
  const root = await realpath(directory)
  const candidate = path.resolve(root, relativePath)
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("operation artifact path escapes the operation")
  const actual = await realpath(candidate)
  const actualRelative = path.relative(root, actual)
  if (!actualRelative || actualRelative.startsWith("..") || path.isAbsolute(actualRelative))
    throw new Error("operation artifact resolves outside the operation")
  return readFile(actual)
}

function renderHTML(input: {
  operation: OperationRecord
  evidence: NormalizedEvidence | undefined
  findings: ReportFinding[]
  runtimeSummary: ReturnType<typeof createRuntimeSummary>
  sourceDigest: string
  generatedAt: string
}) {
  const claims = input.evidence?.claims ?? []
  const evidenceByID = new Map(claims.map((claim) => [claim.id, claim]))
  const findingCards = input.findings.length
    ? input.findings
        .map((finding) => {
          const references = finding.evidenceIDs
            .map((id) => evidenceByID.get(id))
            .filter((claim): claim is EvidenceClaim => claim !== undefined)
          const missingEvidence = finding.evidenceIDs.filter((id) => !evidenceByID.has(id))
          return `<article class="finding"><header><div><p class="eyebrow">${escapeHTML(finding.id)} · ${escapeHTML(finding.state)}</p><h3>${escapeHTML(finding.title)}</h3></div><span class="severity">${escapeHTML(finding.severity)}</span></header>
        <p>${escapeHTML(finding.description)}</p>${finding.impact ? `<p><strong>Impact:</strong> ${escapeHTML(finding.impact)}</p>` : ""}
        ${finding.affectedAssets.length ? `<p class="meta"><strong>Affected assets:</strong> ${finding.affectedAssets.map(escapeHTML).join(", ")}</p>` : ""}
        ${finding.remediation ? `<section class="remediation"><h4>Recommended remediation</h4><p>${escapeHTML(finding.remediation)}</p></section>` : `<p class="limitation">No remediation was recorded in the source finding.</p>`}
        <h4>Evidence references</h4>${references.length ? `<ul>${references.map((claim) => `<li><strong>${escapeHTML(claim.id)}</strong> — ${escapeHTML(claim.summary)} <span class="path">${escapeHTML(safePath(claim.source.path))}</span></li>`).join("")}</ul>` : `<p class="limitation">No cited evidence is available for this finding.</p>`}${missingEvidence.length ? `<p class="limitation">Unresolved evidence IDs: ${missingEvidence.map(escapeHTML).join(", ")}</p>` : ""}</article>`
        })
        .join("\n")
    : `<div class="empty findings-empty"><strong>No validated findings were recorded.</strong><p>Normalized evidence claims are observations and were not promoted to security findings.</p></div>`
  const evidenceCards = claims.length
    ? claims
        .map(
          (claim) =>
            `<article class="evidence"><div><strong>${escapeHTML(claim.id)}</strong><span>${escapeHTML(claim.kind)}</span></div><p>${escapeHTML(claim.summary)}</p>${claim.subject ? `<p class="meta">Subject: ${escapeHTML(claim.subject)}</p>` : ""}<p class="path">Source: ${escapeHTML(safePath(claim.source.path))}${claim.source.sha256 ? ` · SHA-256 ${escapeHTML(claim.source.sha256)}` : ""}</p></article>`,
        )
        .join("\n")
    : `<p class="empty">No normalized evidence claims were recorded for this operation.</p>`
  const executions = input.operation.executions.length
    ? input.operation.executions
        .map(
          (execution) =>
            `<article class="execution-card"><header><strong>${escapeHTML(execution.id)}</strong><span class="execution-status">${escapeHTML(execution.status)}</span></header><dl><div><dt>Phase</dt><dd>${escapeHTML(execution.phaseID)}</dd></div><div><dt>Adapter</dt><dd>${escapeHTML(execution.adapter)}</dd></div><div><dt>Attempt</dt><dd>${execution.attempt}</dd></div></dl><p class="execution-error">${escapeHTML(execution.errorSummary ? sanitizeText(execution.errorSummary) : "No execution error recorded.")}</p></article>`,
        )
        .join("")
    : `<div class="empty">No executions were recorded.</div>`
  const assumptions = input.operation.plan?.assumptions ?? []
  const successCriteria = input.operation.plan?.successCriteria ?? []
  const requiredPhases = input.operation.plan?.phases.filter((phase) => phase.required) ?? []
  const collectionStatus = !input.operation.plan
    ? "No plan recorded"
    : requiredPhases.length === 0
      ? "No required phases"
      : requiredPhases.every((phase) => phase.status === "complete")
        ? "Collection complete"
        : requiredPhases.some((phase) => phase.status === "blocked" || phase.status === "failed")
          ? "Collection incomplete"
          : "Collection in progress"
  const limitations = [
    ...new Set([...(input.evidence?.limitations ?? []), ...(input.runtimeSummary.limitations ?? [])]),
  ]
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(input.operation.objective)}</title>
<style>
:root{color-scheme:light;--ink:#14232d;--muted:#5a6a73;--line:#d8e0e4;--paper:#f4f6f4;--card:#fff;--teal:#087e80;--deep:#123b48;--soft:#e5f1ee;--warn:#9d4b2d}*{box-sizing:border-box}html{background:var(--paper)}body{margin:0;color:var(--ink);font:15px/1.58 Inter,"Segoe UI",Arial,sans-serif;background:linear-gradient(115deg,#e5f1ee 0,transparent 32rem),var(--paper)}main{max-width:1020px;margin:0 auto;padding:54px 62px 70px}h1,h2,h3,h4{line-height:1.2;margin-top:0}h1{font-size:48px;max-width:800px;letter-spacing:-1.8px;margin:24px 0 20px}h2{font-size:25px;border-bottom:2px solid var(--deep);padding-bottom:11px;margin:48px 0 20px}h3{font-size:20px;margin:0}h4{font-size:14px;margin:22px 0 8px}p{margin:8px 0 14px}.cover{min-height:640px;display:flex;flex-direction:column;justify-content:space-between;padding:30px 0 44px;border-bottom:1px solid var(--line);page-break-after:always}.kicker,.eyebrow{color:var(--teal);font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase}.lede{font-size:20px;max-width:760px;color:#38505c}.metadata{display:grid;grid-template-columns:1fr 1fr;gap:10px 30px;color:var(--muted);font-size:13px;border-left:4px solid var(--teal);padding:10px 0 10px 16px}.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metric{background:var(--deep);color:white;padding:19px 20px;min-height:118px}.metric strong{display:block;font-size:31px;line-height:1.15}.metric span{display:block;color:#cce2e0;font-size:12px;margin-top:7px}.section{break-inside:auto}.finding,.evidence,.panel{background:var(--card);border:1px solid var(--line);padding:20px 22px;margin:14px 0;break-inside:avoid}.finding header{display:flex;justify-content:space-between;align-items:start;gap:18px;border-bottom:1px solid var(--line);padding-bottom:13px;margin-bottom:14px}.severity{background:var(--deep);color:white;padding:5px 10px;font-size:11px;font-weight:800;text-transform:uppercase;white-space:nowrap}.meta,.path{color:var(--muted);font-size:12px;overflow-wrap:anywhere;word-break:break-all;max-width:100%}.path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.remediation{background:var(--soft);padding:12px 16px;border-left:3px solid var(--teal)}.remediation p{margin-bottom:0}.evidence>div{display:flex;justify-content:space-between;gap:12px}.evidence>div span{font-size:11px;text-transform:uppercase;color:var(--teal);font-weight:800}.empty,.limitation{color:var(--muted);background:#f7f8f7;padding:12px 15px}.findings-empty{break-inside:avoid;page-break-inside:avoid}.limitation{font-size:12px}.empty p{margin-bottom:0}.execution-card{background:var(--card);border:1px solid var(--line);padding:15px 18px;margin:12px 0;break-inside:avoid}.execution-card header{display:flex;justify-content:space-between;gap:12px;overflow-wrap:anywhere;border-bottom:1px solid var(--line);padding-bottom:9px}.execution-status{font-size:11px;font-weight:800;text-transform:uppercase;color:var(--teal);white-space:nowrap}.execution-card dl{display:grid;grid-template-columns:2fr 1fr .5fr;gap:10px;margin:12px 0}.execution-card dl div{min-width:0}.execution-card dt{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}.execution-card dd{margin:2px 0 0;overflow-wrap:anywhere;word-break:break-word}.execution-error{font-size:12px;color:var(--muted);margin-bottom:0;overflow-wrap:anywhere;word-break:break-word}.digest{font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;color:var(--muted)}footer{border-top:1px solid var(--line);margin-top:52px;padding-top:16px;color:var(--muted);font-size:11px}@page{size:letter;margin:.62in}@media print{html,body{background:white}main{max-width:none;padding:0}.cover{min-height:8.7in}.metric,.severity{-webkit-print-color-adjust:exact;print-color-adjust:exact}.finding,.evidence,.panel{box-shadow:none}h2{break-after:avoid}}
</style></head><body><main>
<section class="cover"><div><p class="kicker">ULMCode · Operation security report</p><h1>${escapeHTML(input.operation.objective)}</h1><p class="lede">An evidence-led record of the operation’s scope, recorded execution, validated findings, and limitations.</p><div class="metadata"><span>Operation <strong>${escapeHTML(input.operation.id)}</strong></span><span>Collection status <strong>${escapeHTML(collectionStatus)}</strong></span><span>Source revision <strong>${input.operation.revision}</strong></span><span>Scope mode <strong>${escapeHTML(input.operation.scope.mode)}</strong></span><span>Generated <strong>${escapeHTML(input.generatedAt)}</strong></span></div></div><div class="metric-grid"><div class="metric"><strong>${input.findings.length}</strong><span>validated findings included</span></div><div class="metric"><strong>${claims.length}</strong><span>normalized evidence claims</span></div><div class="metric"><strong>${input.operation.executions.length}</strong><span>recorded executions</span></div></div></section>
<section class="section"><h2>Executive summary</h2><div class="panel"><p>${escapeHTML(input.operation.objective)}</p><p>Collection status at source revision ${input.operation.revision}: <strong>${escapeHTML(collectionStatus)}</strong>. This report includes ${input.findings.length} explicitly validated or report-ready findings and ${claims.length} normalized evidence claims. Claims remain observations unless the canonical findings artifact records a validated finding with cited evidence. Final handoff readiness is enforced separately by the operation audit.</p></div></section>
<section class="section"><h2>Scope and method</h2><div class="panel"><p><strong>Mode:</strong> ${escapeHTML(input.operation.scope.mode)}</p><p><strong>Targets:</strong> ${input.operation.scope.targets.length ? input.operation.scope.targets.map(escapeHTML).join(", ") : "No targets recorded."}</p>${input.operation.plan ? `<p><strong>Plan approved:</strong> ${escapeHTML(input.operation.plan.approvedAt ?? "No approval timestamp recorded.")}</p>` : `<p class="limitation">No approved plan is present in the operation snapshot.</p>`}<h3>Success criteria</h3>${successCriteria.length ? `<ul>${successCriteria.map((value) => `<li>${escapeHTML(value)}</li>`).join("")}</ul>` : `<p class="limitation">No plan success criteria were recorded.</p>`}<h3>Plan assumptions</h3>${assumptions.length ? `<ul>${assumptions.map((value) => `<li>${escapeHTML(value)}</li>`).join("")}</ul>` : `<p class="limitation">No plan assumptions were recorded.</p>`}</div></section>
<section class="section"><h2>Validated findings</h2>${findingCards}</section>
<section class="section"><h2>Evidence register</h2>${evidenceCards}</section>
<section class="section"><h2>Recorded execution</h2>${executions}</section>
<section class="section"><h2>Remediation and next steps</h2>${input.findings.length ? input.findings.map((finding) => `<article class="panel"><h3>${escapeHTML(finding.title)}</h3><p>${escapeHTML(finding.remediation ?? "No remediation was recorded. Obtain reviewer guidance before treating this as an actionable remediation plan.")}</p><p class="meta">Derived from finding ${escapeHTML(finding.id)}; evidence: ${finding.evidenceIDs.length ? finding.evidenceIDs.map(escapeHTML).join(", ") : "none"}.</p></article>`).join("") : `<div class="empty"><p>No findings were recorded, so this report does not invent remediation work. Revisit only if additional evidence or validated findings become available.</p></div>`}</section>
<section class="section"><h2>Runtime summary and limitations</h2><div class="panel"><p><strong>Recorded operation state at render:</strong> ${escapeHTML(input.runtimeSummary.status)}</p><p>This state belongs to source revision ${input.operation.revision}; final audit runs after report artifacts are registered.</p><p><strong>Audit state at render:</strong> ${escapeHTML(input.runtimeSummary.audit?.status ?? "not recorded")}</p>${limitations.length ? `<ul>${limitations.map((value) => `<li>${escapeHTML(value)}</li>`).join("")}</ul>` : `<p>No evidence or runtime limitations were recorded in the source artifacts.</p>`}</div><p class="digest">Source digest: ${escapeHTML(input.sourceDigest)}</p></section>
<footer>Generated from operation ${escapeHTML(input.operation.id)} at revision ${input.operation.revision}. This document reflects the durable artifacts named by the operation source digest; final lint separately verifies the exact package, hashes, source digest, and current audit.</footer></main></body></html>`
}

async function renderPDF(chromiumPath: string, htmlPath: string, pdfPath: string) {
  try {
    const child = Bun.spawn(
      [
        chromiumPath,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-extensions",
        "--no-pdf-header-footer",
        `--print-to-pdf=${pdfPath}`,
        pathToFileURL(htmlPath).href,
      ],
      { stdout: "ignore", stderr: "pipe" },
    )
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    if (exitCode !== 0)
      return { ok: false as const, error: `Chromium exited with code ${exitCode}: ${stderr.slice(-1200).trim()}` }
    const content = await readFile(pdfPath).catch(() => undefined)
    if (!content || content.length < 8 || content.subarray(0, 5).toString() !== "%PDF-") {
      return { ok: false as const, error: "Chromium exited successfully but did not produce a valid PDF file." }
    }
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: `Chromium could not render the report: ${message(error)}` }
  }
}

async function discoverChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter((candidate): candidate is string => Boolean(candidate))
  const playwrightCache = path.join(process.env.HOME ?? "", ".cache", "ms-playwright")
  const versions = await readdir(playwrightCache).catch(() => [])
  candidates.push(
    ...versions
      .filter((version) => /^chromium-\d+$/.test(version))
      .flatMap((version) => [
        path.join(playwrightCache, version, "chrome-linux64", "chrome"),
        path.join(playwrightCache, version, "chrome-linux", "chrome"),
      ]),
  )
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return undefined
}

function safePath(value: string | undefined) {
  if (!value) return "[path not recorded]"
  const normalized = value.replaceAll("\\", "/")
  if (path.isAbsolute(value) || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes(".."))
    return "[external path redacted]"
  return normalized
}

function escapeHTML(value: string) {
  return sanitizeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function sanitizeText(value: string) {
  return value
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:token|access_token|api_key|key|password|secret)=)[^&#\s]*/gi, "$1[REDACTED]")
    .replace(/(?:\/home\/|\/tmp\/|\/var\/|\/Users\/)[^\s,:;]+/g, "[local path redacted]")
}

function digest(value: unknown) {
  const bytes = typeof value === "string" || value instanceof Uint8Array ? value : canonicalJSON(value)
  return createHash("sha256").update(bytes).digest("hex")
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

function sameStrings(value: unknown, expected: string[]) {
  return (
    Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
