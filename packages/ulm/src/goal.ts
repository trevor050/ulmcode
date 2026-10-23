import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { operationSourceDigest, type CompletionGate, type GoalVerdict, type OperationRecord } from "./operation"
import { lintReport } from "./report"

export const DEFAULT_COMPLETION_GATES: CompletionGate[] = [
  "plan_approved",
  "required_phases_complete",
  "evidence_normalized",
  "runtime_summary",
  "report_manifest",
  "audit_passed",
]

export function recordGoalReview(
  record: OperationRecord,
  verdict: GoalVerdict,
  input: { now?: Date; reason?: string; toolUsed?: boolean } = {},
): OperationRecord {
  const now = (input.now ?? new Date()).toISOString()
  const noToolStreak = input.toolUsed ? 0 : record.goal.continuation.noToolStreak + 1
  return {
    ...record,
    updatedAt: now,
    goal: {
      ...record.goal,
      continuation: { ...record.goal.continuation, noToolStreak },
      review: { verdict, at: now, reason: input.reason },
    },
  }
}

function validJsonFile(file: string) {
  if (!existsSync(file)) return false
  try {
    JSON.parse(readFileSync(file, "utf8")) as unknown
    return true
  } catch {
    return false
  }
}

function requiredPhaseBlockers(record: OperationRecord) {
  return (record.plan?.phases ?? [])
    .filter((phase) => phase.required && phase.status !== "complete")
    .map((phase) => `required phase ${phase.id} is ${phase.status}`)
}

function containedFile(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath)
  const relative = path.relative(root, resolved)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined
  if (!existsSync(resolved)) return undefined
  try {
    const real = realpathSync(resolved)
    const realRelative = path.relative(realpathSync(root), real)
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) return undefined
    return real
  } catch {
    return undefined
  }
}

function sourceRevisionMatches(manifest: unknown, record: OperationRecord, operationDirectory: string) {
  if (!manifest || typeof manifest !== "object") return false
  const row = manifest as { operationID?: unknown; sourceRevision?: unknown; sourceDigest?: unknown; files?: unknown }
  if (
    row.operationID !== record.id ||
    row.sourceRevision !== record.reportSourceRevision ||
    typeof row.sourceDigest !== "string" ||
    row.sourceDigest !== record.reportSourceDigest ||
    row.sourceDigest !== operationSourceDigest(record) ||
    !Array.isArray(row.files) ||
    row.files.length !== 3
  ) return false
  const listed = new Map(
    row.files.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const file = item as { path?: unknown; sha256?: unknown }
      return typeof file.path === "string" && typeof file.sha256 === "string" ? [[file.path, file.sha256] as const] : []
    }),
  )
  if (listed.size !== 3) return false
  const manifestPath = "deliverables/final/manifest.json"
  const manifestRef = record.artifacts.find((artifact) => artifact.path === manifestPath)
  const manifestFile = containedFile(operationDirectory, manifestPath)
  if (!manifestRef?.sha256 || !manifestFile || createHash("sha256").update(readFileSync(manifestFile)).digest("hex") !== manifestRef.sha256) return false
  return ["report.html", "report.pdf", "runtime-summary.json"].every((name) => {
    const relative = `deliverables/final/${name}`
    const expected = listed.get(relative)
    const file = containedFile(operationDirectory, relative)
    if (!expected || !file) return false
    return createHash("sha256").update(readFileSync(file)).digest("hex") === expected
  })
}

export async function completionBlockers(
  record: OperationRecord,
  input: { operationDirectory: string; now?: Date; requireFreshAudit?: boolean },
): Promise<string[]> {
  const blockers: string[] = []
  const gates = new Set(record.goal.gates)
  const now = input.now ?? new Date()
  if (record.goal.targetDurationMs !== undefined) {
    const elapsed = now.getTime() - Date.parse(record.goal.startedAt)
    if (!Number.isFinite(elapsed) || elapsed < record.goal.targetDurationMs) {
      const remaining = Number.isFinite(elapsed) ? Math.max(0, record.goal.targetDurationMs - elapsed) : record.goal.targetDurationMs
      blockers.push(`target duration remains: ${remaining}ms`)
    }
  }
  if (gates.has("plan_approved") && (!record.plan?.approvedAt || !record.plan.approvedBy)) blockers.push("operation plan is not approved")
  if (gates.has("required_phases_complete")) blockers.push(...requiredPhaseBlockers(record))
  if (gates.has("evidence_normalized") && !record.evidence?.normalizedAt) blockers.push("normalized evidence is missing")

  const finalDir = path.join("deliverables", "final")
  const reportPaths = [
    `${finalDir}/report.html`,
    `${finalDir}/report.pdf`,
    `${finalDir}/manifest.json`,
    `${finalDir}/runtime-summary.json`,
  ]
  const manifestFile = containedFile(input.operationDirectory, `${finalDir}/manifest.json`)
  let manifest: unknown
  if (manifestFile && validJsonFile(manifestFile)) manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as unknown
  if (gates.has("runtime_summary")) {
    const summaryPath = reportPaths[3]!
    const summary = containedFile(input.operationDirectory, summaryPath)
    if (!summary || !validJsonFile(summary)) blockers.push(`${summaryPath} is missing or invalid`)
  }
  if (gates.has("report_manifest")) {
    const missing = reportPaths.filter((file) => !containedFile(input.operationDirectory, file))
    if (missing.length) blockers.push(`final report artifacts are missing: ${missing.join(", ")}`)
    if (!manifest) blockers.push(`${reportPaths[2]!} is missing or invalid JSON`)
    else if (!sourceRevisionMatches(manifest, record, input.operationDirectory)) blockers.push(`${reportPaths[2]} references stale source data or invalid file hashes`)
    const lint = await lintReport({ operation: record, operationDirectory: input.operationDirectory, requireAudit: false })
    if (!lint.ok) blockers.push(...lint.blockers.map((blocker) => `report lint: ${blocker}`))
  }
  if (gates.has("audit_passed") && input.requireFreshAudit && record.audit?.status !== "passed") blockers.push("operation audit has not passed")
  if (gates.has("stage_gate")) {
    const gate = containedFile(input.operationDirectory, "deliverables/stage-gates/handoff.json")
    if (!gate || !validJsonFile(gate)) blockers.push("deliverables/stage-gates/handoff.json is missing or invalid")
  }
  return blockers
}

export function applyCompletionGate(
  record: OperationRecord,
  blockers: string[],
  now = new Date(),
): { operation: OperationRecord; completed: boolean; blockers: string[] } {
  const completed = blockers.length === 0
  const updated: OperationRecord = {
    ...record,
    updatedAt: now.toISOString(),
    status: completed ? "completed" : record.status === "draft" ? "draft" : "blocked",
    lastError: completed ? undefined : record.lastError,
    goal: {
      ...record.goal,
      status: completed ? "complete" : "active",
      completion: { checkedAt: now.toISOString(), blockers: [...blockers] },
    },
    audit: {
      status: completed ? "passed" : "blocked",
      checkedAt: now.toISOString(),
      blockers: [...blockers],
      recordRevision: record.revision + 1,
    },
  }
  return { operation: updated, completed, blockers: [...blockers] }
}
