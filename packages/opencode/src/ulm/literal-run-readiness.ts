import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"

export type LiteralRunReadinessStatus = "passed" | "ready" | "incomplete" | "blocked"
export type LiteralRunCheckStatus = "ok" | "warn" | "fail"

export type LiteralRunReadinessInput = {
  operationID: string
  targetElapsedSeconds?: number
  now?: () => Date
}

export type LiteralRunCheck = {
  id: string
  status: LiteralRunCheckStatus
  required: boolean
  detail: string
  path?: string
}

export type LiteralRunReadinessResult = {
  operationID: string
  status: LiteralRunReadinessStatus
  targetElapsedSeconds: number
  checkedAt: string
  literalElapsedSeconds?: number
  checks: LiteralRunCheck[]
  gaps: string[]
  auditPath: string
  markdownPath: string
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function numberArg(command: string[] | undefined, name: string) {
  if (!command) return undefined
  const index = command.indexOf(name)
  if (index === -1) return undefined
  const parsed = Number(command[index + 1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function check(input: LiteralRunCheck): LiteralRunCheck {
  return input
}

function statusFor(checks: LiteralRunCheck[], literalElapsedSeconds: number | undefined, targetElapsedSeconds: number) {
  const requiredSetupFailed = checks.some((item) => item.required && item.status === "fail" && item.id !== "literal-runtime-proof")
  if (requiredSetupFailed) return "blocked"
  if (literalElapsedSeconds !== undefined && literalElapsedSeconds >= targetElapsedSeconds) return "passed"
  if (checks.some((item) => item.id === "literal-runtime-proof" && item.status === "fail")) return "incomplete"
  return "ready"
}

function formatMarkdown(result: LiteralRunReadinessResult) {
  return [
    `# Literal 20-Hour Run Readiness: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- target_elapsed_seconds: ${result.targetElapsedSeconds}`,
    `- literal_elapsed_seconds: ${result.literalElapsedSeconds ?? "not proven"}`,
    `- checked_at: ${result.checkedAt}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Required | Detail |",
    "| --- | --- | --- | --- |",
    ...result.checks.map(
      (item) =>
        `| ${item.id} | ${item.status} | ${item.required ? "yes" : "no"} | ${item.detail.replaceAll("|", "\\|")} |`,
    ),
    "",
    "## Gaps",
    "",
    ...(result.gaps.length ? result.gaps.map((gap) => `- ${gap}`) : ["- none"]),
    "",
  ].join("\n")
}

export async function auditLiteralRunReadiness(
  worktree: string,
  input: LiteralRunReadinessInput,
): Promise<LiteralRunReadinessResult> {
  const operationID = slug(input.operationID, "operation")
  const targetElapsedSeconds = Math.max(1, Math.floor(input.targetElapsedSeconds ?? 20 * 60 * 60))
  const root = operationPath(worktree, operationID)
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const supervisorManifestPath = path.join(root, "scheduler", "supervisor", "supervisor-manifest.json")
  const daemonHeartbeatPath = path.join(root, "scheduler", "daemon-heartbeat.json")
  const daemonLogPath = path.join(root, "scheduler", "daemon.jsonl")
  const burnInProofPath = path.join(root, "burnin", "burnin-proof.json")
  const toolPreflightPath = path.join(root, "tools", "tool-preflight.json")
  const modelRouteAuditPath = path.join(root, "deliverables", "model-route-audit.json")
  const finalManifestPath = path.join(root, "deliverables", "final", "manifest.json")
  const auditPath = path.join(root, "scheduler", "literal-run-readiness.json")
  const markdownPath = path.join(root, "scheduler", "literal-run-readiness.md")
  const checks: LiteralRunCheck[] = []

  const graph = await readJson<{ safetyMode?: string; lanes?: unknown[] }>(graphPath)
  checks.push(
    check({
      id: "operation-graph",
      status: graph?.safetyMode === "non_destructive" && Array.isArray(graph.lanes) && graph.lanes.length > 0 ? "ok" : "fail",
      required: true,
      detail: graph ? `safety=${graph.safetyMode}; lanes=${graph.lanes?.length ?? 0}` : "operation graph is missing",
      path: graphPath,
    }),
  )

  const supervisor = await readJson<{ command?: string[]; files?: Record<string, string | undefined> }>(supervisorManifestPath)
  const supervisorDurationSeconds = numberArg(supervisor?.command, "--duration-seconds")
  checks.push(
    check({
      id: "service-supervisor",
      status:
        supervisor && supervisorDurationSeconds !== undefined && supervisorDurationSeconds >= targetElapsedSeconds ? "ok" : "fail",
      required: true,
      detail: supervisor
        ? `duration_seconds=${supervisorDurationSeconds ?? "missing"}; launchd=${supervisor.files?.launchdPlist ? "yes" : "no"}; systemd=${supervisor.files?.systemdService ? "yes" : "no"}`
        : "launchd/systemd supervisor manifest is missing",
      path: supervisorManifestPath,
    }),
  )

  const burnIn = await readJson<{ auditStatus?: string; elapsedTargetSeconds?: number; simulatedElapsedSeconds?: number }>(
    burnInProofPath,
  )
  checks.push(
    check({
      id: "accelerated-burnin-proof",
      status:
        burnIn?.auditStatus === "passed" &&
        (burnIn.elapsedTargetSeconds ?? 0) >= targetElapsedSeconds &&
        (burnIn.simulatedElapsedSeconds ?? 0) >= targetElapsedSeconds
          ? "ok"
          : "warn",
      required: false,
      detail: burnIn
        ? `audit=${burnIn.auditStatus}; simulated_elapsed_seconds=${burnIn.simulatedElapsedSeconds ?? "missing"}`
        : "accelerated burn-in proof is missing",
      path: burnInProofPath,
    }),
  )

  const toolPreflight = await readJson<{ total?: number; available?: number; blocked?: number }>(toolPreflightPath)
  checks.push(
    check({
      id: "tool-preflight",
      status: toolPreflight ? (toolPreflight.blocked === 0 ? "ok" : "warn") : "warn",
      required: false,
      detail: toolPreflight
        ? `available=${toolPreflight.available ?? 0}/${toolPreflight.total ?? 0}; blocked=${toolPreflight.blocked ?? 0}`
        : "tool-preflight.json is missing",
      path: toolPreflightPath,
    }),
  )

  checks.push(
    check({
      id: "model-route-audit",
      status: (await exists(modelRouteAuditPath)) ? "ok" : "warn",
      required: false,
      detail: (await exists(modelRouteAuditPath)) ? "model route audit exists" : "model-route-audit.json is missing",
      path: modelRouteAuditPath,
    }),
  )

  const heartbeat = await readJson<{ elapsedSeconds?: number; reason?: string; cycles?: unknown[] }>(daemonHeartbeatPath)
  const literalElapsedSeconds = heartbeat?.elapsedSeconds
  const log = await readText(daemonLogPath)
  checks.push(
    check({
      id: "literal-runtime-proof",
      status: literalElapsedSeconds !== undefined && literalElapsedSeconds >= targetElapsedSeconds && !!log?.trim() ? "ok" : "fail",
      required: true,
      detail: heartbeat
        ? `elapsed_seconds=${literalElapsedSeconds ?? "missing"}; reason=${heartbeat.reason ?? "missing"}; log=${log?.trim() ? "present" : "missing"}`
        : "daemon heartbeat is missing; no wall-clock run proof exists",
      path: daemonHeartbeatPath,
    }),
  )

  checks.push(
    check({
      id: "final-package",
      status: (await exists(finalManifestPath)) ? "ok" : "warn",
      required: false,
      detail: (await exists(finalManifestPath)) ? "final handoff manifest exists" : "final package manifest is missing",
      path: finalManifestPath,
    }),
  )

  const status = statusFor(checks, literalElapsedSeconds, targetElapsedSeconds)
  const gaps = checks
    .filter((item) => item.status !== "ok")
    .map((item) => `${item.id}: ${item.detail}`)
  const result: LiteralRunReadinessResult = {
    operationID,
    status,
    targetElapsedSeconds,
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    literalElapsedSeconds,
    checks,
    gaps,
    auditPath,
    markdownPath,
  }
  await fs.mkdir(path.dirname(auditPath), { recursive: true })
  await fs.writeFile(auditPath, JSON.stringify(result, null, 2) + "\n")
  await fs.writeFile(markdownPath, formatMarkdown(result))
  return result
}

export function formatLiteralRunReadiness(result: LiteralRunReadinessResult) {
  return [
    `# Literal Run Readiness: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- target_elapsed_seconds: ${result.targetElapsedSeconds}`,
    `- literal_elapsed_seconds: ${result.literalElapsedSeconds ?? "not proven"}`,
    `- audit: ${result.auditPath}`,
    `- markdown: ${result.markdownPath}`,
  ].join("\n")
}
