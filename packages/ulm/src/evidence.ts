import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { ArtifactRef, EvidenceClaim, NormalizedEvidence, OperationRecord } from "./operation"

const NORMALIZER_VERSION = "ulm-evidence-v1"

function redact(value: string) {
  return value
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, 1000)
}

function within(root: string, reference: ArtifactRef) {
  const resolved = path.resolve(root, reference.path)
  const relative = path.relative(root, resolved)
  if (path.isAbsolute(reference.path) || !relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`artifact reference is outside the operation: ${reference.path}`)
  }
  const realRoot = realpathSync(root)
  const realFile = realpathSync(resolved)
  const realRelative = path.relative(realRoot, realFile)
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`artifact resolves outside the operation: ${reference.path}`)
  }
  return { file: realFile, relative: realRelative.split(path.sep).join("/") }
}

function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function parseClaims(record: OperationRecord, source: ArtifactRef, content: string): EvidenceClaim[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch {
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    return lines.slice(0, 100).map((line) => ({
      id: digest(`${source.sha256}:${line}`).slice(0, 24),
      kind: "observation",
      summary: redact(line),
      source,
    }))
  }
  if (!parsed || typeof parsed !== "object") return []
  const row = parsed as { observations?: unknown; findings?: unknown; lab?: unknown }
  const values = Array.isArray(row.observations) ? row.observations : Array.isArray(row.findings) ? row.findings : []
  return values.flatMap((value, index) => {
    if (!value || typeof value !== "object") return []
    const item = value as { kind?: unknown; subject?: unknown; summary?: unknown; confidence?: unknown }
    if (typeof item.summary !== "string" || !item.summary.trim()) return []
    const kind = typeof item.kind === "string" && item.kind.trim() ? item.kind.trim().slice(0, 80) : "observation"
    const subject = typeof item.subject === "string" ? redact(item.subject) : undefined
    const summary = redact(item.summary)
    const rawConfidence = Number(item.confidence)
    const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : undefined
    return [{
      id: digest(`${record.id}:${source.sha256}:${index}:${kind}:${subject ?? ""}:${summary}`).slice(0, 24),
      kind,
      subject,
      summary,
      confidence,
      source,
    }]
  })
}

export async function normalizeEvidence(record: OperationRecord, operationDirectory: string): Promise<NormalizedEvidence> {
  const root = realpathSync(operationDirectory)
  // Only immutable source artifacts belong in normalized evidence. These files
  // are derived from the sources and must not become inputs to their own rebuild.
  const input = [...record.artifacts, ...record.executions.flatMap((execution) => execution.artifactRefs)]
    .filter((reference) => reference.path !== "evidence/normalized.json" && !reference.path.startsWith("deliverables/final/"))
  const unique = new Map<string, { reference: ArtifactRef; content: string }>()
  for (const reference of input) {
    const resolved = within(root, reference)
    const bytes = readFileSync(resolved.file)
    const sha256 = digest(bytes)
    const content = bytes.toString()
    unique.set(`${resolved.relative}:${sha256}`, {
      reference: { path: resolved.relative, mediaType: reference.mediaType, sha256, size: bytes.byteLength },
      content,
    })
  }
  const artifacts = [...unique.values()].map((item) => item.reference)
  const claims = [...unique.values()].flatMap(({ reference, content }) => parseClaims(record, reference, content))
  const deduplicated = [...new Map(claims.map((claim) => [`${claim.kind}:${claim.subject ?? ""}:${claim.summary}`, claim])).values()]
  const result: NormalizedEvidence = {
    operationID: record.id,
    normalizedAt: "",
    normalizerVersion: NORMALIZER_VERSION,
    artifacts,
    claims: deduplicated,
    limitations: input.length && !deduplicated.length ? ["No structured claims were parsed from the referenced artifacts."] : [],
  }
  const prior = record.evidence ? { ...record.evidence, normalizedAt: "" } : undefined
  result.normalizedAt = prior && JSON.stringify(prior) === JSON.stringify(result)
    ? record.evidence!.normalizedAt
    : new Date().toISOString()
  const directory = path.join(root, "evidence")
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, "normalized.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  return result
}
