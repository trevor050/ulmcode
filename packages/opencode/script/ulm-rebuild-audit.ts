#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

const packageRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(readArg("--repo-root") ?? path.resolve(packageRoot, "../.."))

type CheckResult = {
  id: string
  status: "ok"
  detail: string
  summary?: string
}

type ToolManifest = {
  policy?: {
    defaultSafetyMode?: string
    destructiveSafetyMode?: string
    installFailureBehavior?: string
  }
  tools?: Array<{ id?: string }>
  commandProfiles?: Array<{
    id?: string
    tool?: string
    safety?: string
    template?: string
    heartbeatSeconds?: number
    idleTimeoutSeconds?: number
    hardTimeoutSeconds?: number
    restartable?: boolean
    artifacts?: string[]
  }>
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function readArg(name: string) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function read(relative: string) {
  return fs.readFile(path.join(repoRoot, relative), "utf8")
}

async function exists(relative: string) {
  try {
    await fs.access(path.join(repoRoot, relative))
    return true
  } catch {
    return false
  }
}

function requireText(file: string, content: string, needles: string[]) {
  for (const needle of needles) {
    assert(content.includes(needle), `${file}: missing ${needle}`)
  }
}

function validateToolManifestSupervision(content: string) {
  const manifest = JSON.parse(content) as ToolManifest
  assert(manifest.policy?.defaultSafetyMode === "non_destructive", "default safety mode must be non_destructive")
  assert(
    manifest.policy?.destructiveSafetyMode === "interactive_destructive",
    "destructive safety mode must require interactive_destructive",
  )
  assert(
    manifest.policy?.installFailureBehavior === "record_blocker_with_fallback",
    "install failures must become blockers with fallbacks",
  )
  const toolIDs = new Set((manifest.tools ?? []).map((tool) => tool.id).filter((id): id is string => typeof id === "string"))
  assert(toolIDs.size >= 4, "expected at least four tool entries for supervised commands")
  assert((manifest.commandProfiles?.length ?? 0) >= 4, "expected at least four supervised command profiles")
  for (const profile of manifest.commandProfiles ?? []) {
    assert(typeof profile.id === "string" && profile.id.length > 0, "supervised command profile is missing id")
    assert(typeof profile.tool === "string" && toolIDs.has(profile.tool), `${profile.id}: references unknown tool`)
    assert(profile.safety === "non_destructive", `${profile.id}: unattended profiles must be non_destructive`)
    assert(typeof profile.template === "string" && profile.template.length >= 8, `${profile.id}: command template is required`)
    assert(typeof profile.heartbeatSeconds === "number" && profile.heartbeatSeconds > 0, `${profile.id}: heartbeat must be positive`)
    assert(
      typeof profile.idleTimeoutSeconds === "number" && profile.idleTimeoutSeconds >= profile.heartbeatSeconds,
      `${profile.id}: idle timeout must cover heartbeat`,
    )
    assert(
      typeof profile.hardTimeoutSeconds === "number" && profile.hardTimeoutSeconds >= profile.idleTimeoutSeconds,
      `${profile.id}: hard timeout must cover idle timeout`,
    )
    assert(Array.isArray(profile.artifacts) && profile.artifacts.length >= 1, `${profile.id}: expected output artifacts are required`)
    assert(typeof profile.restartable === "boolean", `${profile.id}: restartable flag is required`)
  }
  assert(
    (manifest.commandProfiles ?? []).some((profile) => profile.restartable === true),
    "expected at least one restartable supervised command profile",
  )
}

async function run(command: string[]) {
  const proc = Bun.spawn(command, { cwd: repoRoot, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  assert(exitCode === 0, `${command.join(" ")} failed: ${stderr.trim() || stdout.trim()}`)
  return stdout.trim()
}

async function labManifestIDs() {
  const labsRoot = path.join(repoRoot, "tools", "ulmcode-labs")
  const entries = await fs.readdir(labsRoot, { withFileTypes: true })
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifest = path.join(labsRoot, entry.name, "manifest.json")
          try {
            const content = JSON.parse(await fs.readFile(manifest, "utf8")) as { id?: string }
            return content.id
          } catch {
            return undefined
          }
        }),
    )
  )
    .filter((id): id is string => typeof id === "string")
    .sort()
}

async function labManifests() {
  const labsRoot = path.join(repoRoot, "tools", "ulmcode-labs")
  const entries = await fs.readdir(labsRoot, { withFileTypes: true })
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifest = path.join(labsRoot, entry.name, "manifest.json")
          try {
            return JSON.parse(await fs.readFile(manifest, "utf8")) as {
              id?: string
              findings?: unknown[]
              report?: { authoredMarkdownFile?: string }
            }
          } catch {
            return undefined
          }
        }),
    )
  ).filter(
    (manifest): manifest is { id?: string; findings?: unknown[]; report?: { authoredMarkdownFile?: string } } =>
      manifest !== undefined,
  )
}

async function auditUpstream() {
  const right = await run(["git", "rev-list", "--right-only", "--count", "HEAD...upstream/dev"])
  assert(right === "0", `branch is behind upstream/dev by ${right} commits`)
  return { id: "upstream_current", status: "ok", detail: "branch has no missing upstream/dev commits" } satisfies CheckResult
}

async function auditOperationRuntime() {
  const registry = await read("packages/opencode/src/tool/registry.ts")
  const artifact = await read("packages/opencode/src/ulm/artifact.ts")
  const operationResume = await read("packages/opencode/src/tool/operation_resume.ts")
  const todoService = await read("packages/opencode/src/session/todo.ts")
  const commandService = await read("packages/opencode/src/command/index.ts")
  const configService = await read("packages/opencode/src/config/config.ts")
  const observability = await read("packages/core/src/effect/observability.ts")
  const shellTool = await read("packages/opencode/src/tool/shell.ts")
  const shellPrompt = await read("packages/opencode/src/tool/shell/shell.txt")
  const systemPrompt = await read("packages/opencode/src/session/system.ts")
  const promptPaste = await read("packages/opencode/src/cli/cmd/tui/component/prompt/paste.ts")
  const projectService = await read("packages/opencode/src/project/project.ts")
  const providerTransform = await read("packages/opencode/src/provider/transform.ts")
  const sseRepair = await read("packages/opencode/src/provider/sse-repair.ts")
  const providerService = await read("packages/opencode/src/provider/provider.ts")
  const codexPlugin = await read("packages/opencode/src/plugin/codex.ts")
  const codexTests = await read("packages/opencode/test/plugin/codex.test.ts")
  const pluginTypes = await read("packages/plugin/src/index.ts")
  const sessionPrompt = await read("packages/opencode/src/session/prompt.ts")
  const v2ModelGroup = await read("packages/opencode/src/server/routes/instance/httpapi/groups/v2/model.ts")
  const v2ModelHandler = await read("packages/opencode/src/server/routes/instance/httpapi/handlers/v2/model.ts")
  const sdk = await read("packages/sdk/js/src/v2/gen/sdk.gen.ts")
  const requiredTools = [
    "OperationCheckpointTool",
    "OperationGovernorTool",
    "OperationNextTool",
    "OperationPlanTool",
    "OperationQueueTool",
    "OperationQueueNextTool",
    "OperationRecoverTool",
    "OperationResumeTool",
    "OperationRunTool",
    "OperationScheduleTool",
    "OperationStageGateTool",
    "ReportLintTool",
    "ReportRenderTool",
    "RuntimeDaemonTool",
    "RuntimeSchedulerTool",
    "RuntimeSummaryTool",
    "TaskRestartTool",
    "CommandSuperviseTool",
    "EvidenceNormalizeTool",
    "ToolAcquireTool",
  ]
  requireText("packages/opencode/src/tool/registry.ts", registry, requiredTools)
  requireText("packages/opencode/src/ulm/artifact.ts", artifact, [
    "runtimeHealthGaps",
    "runtime blind spot:",
    "recoverStaleTasks=true",
    "operation_checkpoint",
    "operation_audit",
    "stage-gates",
  ])
  requireText("packages/opencode/src/tool/operation_resume.ts", operationResume, ["recoverStaleTasks", "maxRecoveries"])
  const commandSupervise = await read("packages/opencode/src/tool/command_supervise.ts")
  const toolManifest = await read("packages/opencode/src/ulm/tool-manifest.ts")
  const toolAcquisition = await read("packages/opencode/src/ulm/tool-acquisition.ts")
  const evidenceNormalizer = await read("packages/opencode/src/ulm/evidence-normalizer.ts")
  const operationGraph = await read("packages/opencode/src/ulm/operation-graph.ts")
  const operationNext = await read("packages/opencode/src/ulm/operation-next.ts")
  const workQueue = await read("packages/opencode/src/ulm/work-queue.ts")
  const operationRun = await read("packages/opencode/src/ulm/operation-run.ts")
  const operationRecovery = await read("packages/opencode/src/ulm/operation-recovery.ts")
  const operationRunTool = await read("packages/opencode/src/tool/operation_run.ts")
  const runtimeGovernor = await read("packages/opencode/src/ulm/runtime-governor.ts")
  const runtimeDaemon = await read("packages/opencode/src/ulm/runtime-daemon.ts")
  const runtimeSupervisor = await read("packages/opencode/src/ulm/runtime-supervisor.ts")
  const literalRunReadiness = await read("packages/opencode/src/ulm/literal-run-readiness.ts")
  const modelRuntimeCatalog = await read("packages/opencode/src/ulm/model-runtime-catalog.ts")
  const taskTool = await read("packages/opencode/src/tool/task.ts")
  requireText("packages/opencode/src/tool/command_supervise.ts", commandSupervise, [
    "command_supervise",
    "laneID",
    "writeCommandPlan",
    "BackgroundJob.Service",
    "hardTimeoutSeconds",
  ])
  requireText("packages/opencode/src/ulm/tool-manifest.ts", toolManifest, [
    "buildCommandPlan",
    "unattended command_supervise only allows non_destructive",
    "renderTemplate",
    "writeCommandPlan",
  ])
  requireText("packages/opencode/src/ulm/tool-acquisition.ts", toolAcquisition, [
    "acquireTool",
    "acquireManifestTools",
    "tool-preflight.json",
    "install required before supervised command execution",
    "fallbacks",
    "recordPath",
  ])
  requireText("packages/opencode/src/ulm/evidence-normalizer.ts", evidenceNormalizer, [
    "normalizeEvidence",
    "evidence-index.json",
    "leads.json",
    "httpx-jsonl",
    "nmap-xml",
    "screenshot-json",
    "tls-jsonl",
    "cloud-json",
    "auth_surface",
    "writeEvidence",
  ])
  requireText("packages/opencode/src/ulm/operation-graph.ts", operationGraph, [
    "REQUIRED_OPERATION_LANES",
    "web_inventory",
    "identity_auth_review",
    "report_review",
    "buildOperationGraph",
    "validateOperationGraph",
    "non_destructive lanes must use command_supervise instead of raw shell",
  ])
  requireText("packages/opencode/src/ulm/runtime-governor.ts", runtimeGovernor, [
    "evaluateRuntimeGovernor",
    "writeRuntimeGovernorRouteAudit",
    "model-route-audit.json",
    "operation budget exhausted",
    "context pressure is critical",
    "lane budget exhausted",
    "model route quota exhausted",
    "resolveModelRuntime",
    "contextRatio",
    "formatGovernorDecision",
  ])
  requireText("packages/opencode/src/ulm/model-runtime-catalog.ts", modelRuntimeCatalog, [
    "resolveModelRuntime",
    "auditModelRoutes",
    "contextLimit",
    "outputLimit",
    "costCliffTokens",
    "opencode-go/default",
  ])
  requireText("packages/opencode/src/ulm/operation-next.ts", operationNext, [
    "decideOperationNext",
    "max concurrent lanes",
    "launch_lane",
    "next-action.json",
    "formatOperationNext",
  ])
  requireText("packages/opencode/src/ulm/operation-run.ts", operationRun, [
    "runOperationStep",
    "operation-run.jsonl",
    "complete_lane",
    "fail_lane",
    "autoCompleteLanes",
    "validateLaneCompletionProof",
    "lane-complete",
    "syncBackgroundJobs",
  ])
  requireText("packages/opencode/src/ulm/operation-recovery.ts", operationRecovery, [
    "markRecoveredLanesRunning",
    "recover_lane",
    "operation-run.jsonl",
  ])
  requireText("packages/opencode/src/ulm/runtime-scheduler.ts", await read("packages/opencode/src/ulm/runtime-scheduler.ts"), [
    "runRuntimeScheduler",
    "heartbeat.json",
    "requeueStaleWorkUnits",
    "bindWorkUnitJob",
    "evaluateRuntimeGovernor",
    "runOperationStep",
    "launchCommandWorkUnit",
    "dryRun: false",
  ])
  requireText("packages/opencode/src/ulm/runtime-daemon.ts", runtimeDaemon, [
    "runRuntimeDaemon",
    "daemon.lock.json",
    "staleLockSeconds",
    "errorBackoffSeconds",
    "maxConsecutiveErrors",
    "cycleIntervalSeconds",
    "signal",
  ])
  requireText("packages/opencode/script/ulm-runtime-daemon.ts", await read("packages/opencode/script/ulm-runtime-daemon.ts"), [
    "--detach",
    "daemon-launch.json",
    "child.unref()",
    "--supervisor",
    "writeRuntimeSupervisor",
    "buildCommandPlan",
    "ulm-command-worker.ts",
  ])
  requireText("packages/opencode/script/ulm-command-worker.ts", await read("packages/opencode/script/ulm-command-worker.ts"), [
    "hardTimeoutSeconds",
    "idleTimeoutSeconds",
    "heartbeatPath",
    "proc.kill",
  ])
  requireText("packages/opencode/src/ulm/runtime-supervisor.ts", runtimeSupervisor, [
    "writeRuntimeSupervisor",
    "launchd",
    "systemd",
    "supervisor-install.md",
    "supervisor-manifest.json",
    "Restart=on-failure",
    "Do not add `--detach`",
  ])
  requireText("packages/opencode/script/ulm-burnin.ts", await read("packages/opencode/script/ulm-burnin.ts"), [
    "--target-hours",
    "runBurnInHarness",
  ])
  requireText("packages/opencode/src/ulm/burnin-harness.ts", await read("packages/opencode/src/ulm/burnin-harness.ts"), [
    "burnin-proof.json",
    "simulatedElapsedSeconds",
    "restartCount",
  ])
  requireText("packages/opencode/src/ulm/literal-run-readiness.ts", literalRunReadiness, [
    "auditLiteralRunReadiness",
    "literal-run-readiness.json",
    "literal-runtime-proof",
    "accelerated-burnin-proof",
    "service-supervisor",
  ])
  requireText("packages/opencode/script/ulm-literal-run-readiness.ts", await read("packages/opencode/script/ulm-literal-run-readiness.ts"), [
    "--strict",
    "auditLiteralRunReadiness",
  ])
  requireText("packages/opencode/src/tool/runtime_daemon.ts", await read("packages/opencode/src/tool/runtime_daemon.ts"), [
    "runtime_daemon",
    "BackgroundJob.Service",
    "backgroundJobProvider",
  ])
  requireText("packages/opencode/src/tool/task.ts", taskTool, ["modelRoute", "modelFromRoute", "laneID"])
  requireText("packages/opencode/src/ulm/artifact.ts", artifact, ["byLane"])
  requireText("packages/opencode/src/tool/operation_run.ts", operationRunTool, [
    "launchModelLane",
    "artifacts",
    "evidenceRefs",
    "TaskTool",
    "taskDef.execute",
    "backgroundJobs",
  ])
  requireText("packages/opencode/src/tool/operation_governor.ts", await read("packages/opencode/src/tool/operation_governor.ts"), [
    "Provider.Service",
    "buildModelRuntimeCatalog",
    "writeRuntimeGovernorRouteAudit",
    "model_route_audit",
    "modelCatalog",
  ])
  requireText("packages/opencode/src/tool/task_restart_args.ts", await read("packages/opencode/src/tool/task_restart_args.ts"), [
    "taskRestartArgs",
    "commandRestartArgs",
    "command_supervise",
    "workUnitID",
  ])
  requireText("packages/opencode/src/ulm/work-queue.ts", workQueue, [
    "buildWorkQueue",
    "nextWorkUnits",
    "work-queue.json",
    "commandSupervise",
    "work queue only emits non_destructive",
  ])
  requireText("packages/opencode/src/session/todo.ts", todoService, [
    "export function active",
    'todo.status === "pending"',
    'todo.status === "in_progress"',
  ])
  requireText("packages/opencode/src/command/index.ts", commandService, ["CLEAR_TASKS", "CLEAR_TASKS_ZH", "todowrite"])
  requireText("packages/opencode/src/config/config.ts", configService, ["enable_sse_json_repair"])
  requireText("packages/core/src/effect/observability.ts", observability, [
    "OTEL_SERVICE_NAME",
    "service.version",
    "deployment.environment.name",
  ])
  requireText("packages/opencode/src/tool/shell.ts", shellTool, [
    "isDangerousProcessKillCommand",
    "DANGEROUS_PROCESS_KILL_PATTERNS",
    "Broadly killing Node.js processes can crash OpenCode",
  ])
  requireText("packages/opencode/src/tool/shell/shell.txt", shellPrompt, ["pkill node", "taskkill /F /IM node.exe"])
  requireText("packages/opencode/src/session/system.ts", systemPrompt, ["pkill node", "OpenCode itself runs on Node.js"])
  requireText("packages/opencode/src/cli/cmd/tui/component/prompt/paste.ts", promptPaste, [
    "displayOffsetToStringIndex",
    "expandPromptTextParts",
    "Bun.stringWidth",
  ])
  requireText("packages/opencode/src/project/project.ts", projectService, [
    "isBareRepo ? sandbox",
    "readCachedProjectId(common)",
  ])
  requireText("packages/opencode/src/provider/transform.ts", providerTransform, [
    "providerExecuted",
    "isClientToolPart",
    "tool-result",
    "MAX_DEPTH",
    "sanitizeMoonshot",
    "additionalProperties: true",
  ])
  requireText("packages/opencode/src/provider/sse-repair.ts", sseRepair, ["repairSSEEvent", "jsonrepair", "text/event-stream"])
  requireText("packages/opencode/src/provider/provider.ts", providerService, [
    "cfg.experimental?.enable_sse_json_repair === true",
    "repairSSE(res)",
  ])
  requireText("packages/opencode/src/plugin/codex.ts", codexPlugin, [
    "requireRefreshToken",
    "refreshTokenOrPrevious",
    "currentAuth.refresh = refresh",
  ])
  requireText("packages/opencode/test/plugin/codex.test.ts", codexTests, [
    "preserves existing refresh_token",
    "uses rotated refresh_token",
    "requires refresh_token for initial OAuth",
  ])
  requireText("packages/plugin/src/index.ts", pluginTypes, [
    "pre_chat.messages.transform",
    "@deprecated Use `pre_chat.messages.transform`",
  ])
  requireText("packages/opencode/src/session/prompt.ts", sessionPrompt, [
    "pre_chat.messages.transform",
    "msgs = preChat.messages",
    "msgs = legacyChat.messages",
  ])
  requireText("packages/opencode/src/server/routes/instance/httpapi/groups/v2/model.ts", v2ModelGroup, [
    "v2.model.list",
    "InstanceContextMiddleware",
    "WorkspaceRoutingMiddleware",
  ])
  requireText("packages/opencode/src/server/routes/instance/httpapi/handlers/v2/model.ts", v2ModelHandler, [
    "providerModelToV2Info",
    "Provider.Service",
  ])
  requireText("packages/sdk/js/src/v2/gen/sdk.gen.ts", sdk, ["class Model", "get model()", 'url: "/api/model"'])
  for (const tool of [
    "operation_checkpoint",
    "operation_plan",
    "operation_resume",
    "operation_run",
    "runtime_scheduler",
    "runtime_daemon",
    "operation_queue",
    "operation_queue_next",
    "operation_schedule",
    "operation_next",
    "operation_recover",
    "operation_stage_gate",
    "operation_status",
    "evidence_normalize",
    "runtime_summary",
    "task_restart",
  ]) {
    assert(await exists(`packages/opencode/src/tool/${tool}.ts`), `${tool}.ts is missing`)
    assert(await exists(`packages/opencode/src/tool/${tool}.txt`), `${tool}.txt is missing`)
  }
  const pkg = JSON.parse(await read("packages/opencode/package.json"))
  assert(pkg.scripts?.["ulm:runtime-daemon"]?.includes("ulm-runtime-daemon.ts"), "package script ulm:runtime-daemon is missing")
  assert(pkg.scripts?.["ulm:burnin"]?.includes("ulm-burnin.ts"), "package script ulm:burnin is missing")
  assert(pkg.scripts?.["ulm:tool-preflight"]?.includes("--preflight"), "package script ulm:tool-preflight is missing")
  assert(
    pkg.scripts?.["ulm:literal-run-readiness"]?.includes("ulm-literal-run-readiness.ts"),
    "package script ulm:literal-run-readiness is missing",
  )
  return { id: "operation_runtime", status: "ok", detail: "durable runtime, resume, recovery, and stage tools are wired" } satisfies CheckResult
}

async function auditReportQuality() {
  const artifact = await read("packages/opencode/src/ulm/artifact.ts")
  const reportLint = await read("packages/opencode/src/tool/report_lint.ts")
  const tests = await read("packages/opencode/test/ulm/artifact.test.ts")
  const longReportSkill = await read("tools/ulmcode-profile/skills/pentest-compact/k12-long-report-production/SKILL.md")
  requireText("packages/opencode/src/ulm/artifact.ts", artifact, [
    "FINAL_PACKAGE_FILES",
    "findings.json",
    "evidence-index.json",
    "operator-review.md",
    "executive-summary.md",
    "technical-appendix.md",
    "runtime-summary.md",
    "outlineSectionBudgets",
    "reportSectionForOutlineTitle",
    "requireOutlineSections",
    "minOutlineSectionWords",
    "outline section is too sparse",
    "readAuthoredReport",
    "markdownReportToHtml",
    "htmlToPdfLines",
  ])
  requireText("packages/opencode/src/tool/report_lint.ts", reportLint, [
    "requireOutlineSections",
    "minOutlineSectionWords",
    "minOutlineSectionWordsPerPage",
  ])
  requireText("packages/opencode/test/ulm/artifact.test.ts", tests, [
    "lints missing outline report sections",
    "lints sparse outline report sections",
    "operation audit forwards strict outline section gates",
    "handoff stage gate forwards strict outline section gates",
    "rendered reports preserve authored report markdown",
    "Scope, Authorization, and Methodology",
    "Risk Register and Prioritized Roadmap",
    "deliverables/final/findings.json is required",
    "deliverables/final/evidence-index.json is required",
    "deliverables/final/operator-review.md is required",
  ])
  requireText("tools/ulmcode-profile/skills/pentest-compact/k12-long-report-production/SKILL.md", longReportSkill, [
    "requireOutlineBudget: true",
    "requireOutlineSections: true",
    "requireFindingSections: true",
  ])
  return { id: "report_quality", status: "ok", detail: "strict report outline and finding-section gates are wired" } satisfies CheckResult
}

async function auditProfileRouting() {
  const profileSkills = await read("packages/opencode/script/ulm-profile-skills.ts")
  const profileConfig = await read("tools/ulmcode-profile/opencode.json")
  const omoConfig = await read("tools/ulmcode-profile/oh-my-openagent.jsonc")
  const shellStrategy = await read("tools/ulmcode-profile/plugins/shell-strategy/shell_strategy.md")
  requireText("packages/opencode/script/ulm-profile-skills.ts", profileSkills, [
    "profile model must default to GPT-5.5 Fast",
    "profile small_model must use GPT-5.4 Mini Fast",
    "validator must use xhigh reasoning",
    "report-reviewer must use xhigh reasoning",
    "routing: ok",
  ])
  requireText("tools/ulmcode-profile/opencode.json", profileConfig, [
    '"model": "openai/gpt-5.5-fast"',
    '"small_model": "openai/gpt-5.4-mini-fast"',
    '"default_agent": "pentest"',
    '"enable_sse_json_repair": true',
    "__ULMCODE_PROFILE_DIR__/plugins/shell-strategy/shell_strategy.md",
  ])
  requireText("tools/ulmcode-profile/oh-my-openagent.jsonc", omoConfig, [
    '"repo-scout"',
    '"xhigh-court"',
    '"reasoningEffort": "xhigh"',
  ])
  requireText("tools/ulmcode-profile/plugins/shell-strategy/shell_strategy.md", shellStrategy, [
    "Shell Non-Interactive Strategy",
    "GIT_TERMINAL_PROMPT",
    "Process Continuity",
    "Long Command Handoff",
  ])
  for (const command of [
    "btw.md",
    "commit-msg.md",
    "explain-diff.md",
    "frontend-polish.md",
    "handoff.md",
    "review.md",
    "ship.md",
    "test-plan.md",
  ]) {
    assert(await exists(`tools/ulmcode-profile/commands/${command}`), `profile command ${command} is missing`)
  }
  return {
    id: "profile_routing",
    status: "ok",
    detail: "GPT-5.5/GPT-5.4 routing, xhigh hard-task routes, shell strategy, and local workflow commands are enforced",
  } satisfies CheckResult
}

async function auditProfileRuntime() {
  const profilePackage = await read("tools/ulmcode-profile/package.json")
  const opencodeConfig = await read("tools/ulmcode-profile/opencode.json")
  const guard = await read("tools/ulmcode-profile/plugins/ulmcode-runtime-guard.js")
  const installer = await read("tools/ulmcode-profile/scripts/install-profile.sh")
  const toolManifest = await read("tools/ulmcode-profile/tool-manifest.json")
  validateToolManifestSupervision(toolManifest)
  requireText("tools/ulmcode-profile/package.json", profilePackage, [
    "file:plugins/vendor/oh-my-openagent-3.17.12",
    "oh-my-openagent",
    "oh-my-opencode",
  ])
  assert(!opencodeConfig.includes("oh-my-openagent@latest"), "profile must not use oh-my-openagent@latest")
  requireText("tools/ulmcode-profile/plugins/ulmcode-runtime-guard.js", guard, [
    "operation_resume",
    "operation_supervise",
    "runtime_summary",
    "operation_recover",
    "report_lint",
    "exceed two minutes",
  ])
  requireText("tools/ulmcode-profile/scripts/install-profile.sh", installer, [
    "ulmcode-launch.sh",
    "oh-my-openagent.jsonc",
    "local-opencode",
    "tool-manifest.json",
  ])
  requireText("tools/ulmcode-profile/tool-manifest.json", toolManifest, [
    '"httpx"',
    '"zap-baseline"',
  ])
  assert(
    await exists("tools/ulmcode-profile/plugins/vendor/oh-my-openagent-3.17.12/dist/index.js"),
    "vendored oh-my-openagent dist is missing",
  )
  return { id: "profile_runtime", status: "ok", detail: "isolated profile, runtime guard, and vendored plugins are wired" } satisfies CheckResult
}

async function auditHarnessScheduler() {
  const pkg = JSON.parse(await read("packages/opencode/package.json")) as { scripts?: Record<string, string> }
  const workflow = await read(".github/workflows/ulm-harness.yml")
  requireText(".github/workflows/ulm-harness.yml", workflow, [
    "name: ulm-harness",
    "schedule:",
    "workflow_dispatch:",
  ])
  assert(
    workflow.includes("test:ulm-harness:chaos") || workflow.includes("test:ulm-harness:overnight"),
    ".github/workflows/ulm-harness.yml: missing scheduled long-run harness lane",
  )
  assert(
    pkg.scripts?.["test:ulm-harness:fast"]?.includes("ulm-harness-run.ts --tier fast"),
    "package script test:ulm-harness:fast is missing harness runner",
  )
  assert(
    pkg.scripts?.["test:ulm-harness:overnight"]?.includes("ulm-harness-run.ts --tier overnight"),
    "package script test:ulm-harness:overnight is missing overnight runner",
  )
  const harness = await read("packages/opencode/script/ulm-harness-run.ts")
  const runtimeDaemonTest = await read("packages/opencode/test/ulm/runtime-daemon.test.ts")
  requireText("packages/opencode/script/ulm-harness-run.ts", harness, [
    "runtime-supervisor.ts",
    "supervisor-install.md",
    "Restart=on-failure",
  ])
  requireText("packages/opencode/test/ulm/runtime-daemon.test.ts", runtimeDaemonTest, [
    "writes launchd and systemd supervisor artifacts",
    "launchctl bootstrap",
    "systemctl --user enable --now",
  ])
  return {
    id: "harness_scheduler",
    status: "ok",
    detail: "scheduled harness workflow and overnight readiness command are wired",
  } satisfies CheckResult
}

async function auditLabCatalog() {
  const labReplay = await read("packages/opencode/script/ulm-lab-replay.ts")
  requireText("packages/opencode/script/ulm-lab-replay.ts", labReplay, [
    "requireOutlineBudget: true",
    "requireOutlineSections: true",
    "minOutlineSectionWords",
  ])
  const labs = await labManifestIDs()
  const manifests = await labManifests()
  for (const id of [
    "k12-login-mfa-gap",
    "k12-lms-payment-webhook-replay",
    "k12-family-messaging-cross-class-broadcast",
    "k12-third-party-integration-token-leak",
    "k12-sso-roster-export-chain",
  ]) {
    assert(labs.includes(id), `lab catalog missing ${id}`)
  }
  assert(labs.length >= 15, `expected at least 15 bundled labs, found ${labs.length}`)
  assert(
    manifests.filter((manifest) => (manifest.findings?.length ?? 0) >= 2).length >= 2,
    "expected at least two bundled multi-finding labs",
  )
  assert(
    manifests.some((manifest) => typeof manifest.report?.authoredMarkdownFile === "string"),
    "expected at least one bundled authored-report lab",
  )
  for (const id of labs) {
    assert(await exists(`tools/ulmcode-labs/${id}/service/server.js`), `${id}: service/server.js is missing`)
    assert(await exists(`tools/ulmcode-labs/${id}/docker-compose.yml`), `${id}: docker-compose.yml is missing`)
  }
  return {
    id: "lab_catalog",
    status: "ok",
    detail: `${labs.length} bundled labs include Docker targets, a multi-finding chain, and an authored-report replay`,
    summary: `lab_catalog: ok (${labs.length})`,
  } satisfies CheckResult
}

async function auditRequiredGates() {
  const pkg = JSON.parse(await read("packages/opencode/package.json")) as { scripts?: Record<string, string> }
  const scripts = pkg.scripts ?? {}
  for (const script of [
    "typecheck",
    "test:ulm-smoke",
    "test:ulm-skills",
    "test:ulm-lab",
    "test:ulm-lab-target",
    "test:ulm-rebuild-audit",
    "test:ulm-harness:full",
    "test:ulm-harness:chaos",
    "test:ulm-harness:overnight",
    "test:ulm-tool-manifest",
  ]) {
    assert(typeof scripts[script] === "string", `package script ${script} is missing`)
  }
  const profileVerifier = await read("tools/ulmcode-profile/test-profile.sh")
  requireText("tools/ulmcode-profile/test-profile.sh", profileVerifier, [
    "test:ulm-smoke",
    "test:ulm-skills",
    "test:ulm-lab",
    "test:ulm-lab-target",
    "test:ulm-tool-manifest",
  ])
  return { id: "required_gates", status: "ok", detail: "package and profile verifier scripts include the ULM gates" } satisfies CheckResult
}

const checkRunners = {
  upstream_current: auditUpstream,
  operation_runtime: auditOperationRuntime,
  report_quality: auditReportQuality,
  profile_routing: auditProfileRouting,
  profile_runtime: auditProfileRuntime,
  lab_catalog: auditLabCatalog,
  required_gates: auditRequiredGates,
  harness_scheduler: auditHarnessScheduler,
}

const selectedCheck = readArg("--check")
assert(
  selectedCheck === undefined || selectedCheck in checkRunners,
  `unknown audit check ${selectedCheck}; expected one of ${Object.keys(checkRunners).join(", ")}`,
)
const checks: CheckResult[] = []
for (const runner of selectedCheck === undefined
  ? Object.values(checkRunners)
  : [checkRunners[selectedCheck as keyof typeof checkRunners]]) {
  checks.push(await runner())
}

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        checkedAt: new Date().toISOString(),
        checks,
      },
      null,
      2,
    ),
  )
} else {
  console.log("ulm_rebuild_audit: ok")
  for (const check of checks) console.log(check.summary ?? `${check.id}: ok`)
}
