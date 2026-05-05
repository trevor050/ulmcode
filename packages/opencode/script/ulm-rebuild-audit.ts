#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

const packageRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(packageRoot, "../..")

type CheckResult = {
  id: string
  status: "ok"
  detail: string
  summary?: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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
  const v2ModelGroup = await read("packages/opencode/src/server/routes/instance/httpapi/groups/v2/model.ts")
  const v2ModelHandler = await read("packages/opencode/src/server/routes/instance/httpapi/handlers/v2/model.ts")
  const sdk = await read("packages/sdk/js/src/v2/gen/sdk.gen.ts")
  const requiredTools = [
    "OperationCheckpointTool",
    "OperationPlanTool",
    "OperationRecoverTool",
    "OperationResumeTool",
    "OperationStageGateTool",
    "ReportLintTool",
    "ReportRenderTool",
    "RuntimeSummaryTool",
    "TaskRestartTool",
  ]
  requireText("packages/opencode/src/tool/registry.ts", registry, requiredTools)
  requireText("packages/opencode/src/ulm/artifact.ts", artifact, [
    "runtimeHealthGaps",
    "runtime blind spot:",
    "operation_checkpoint",
    "operation_audit",
    "stage-gates",
  ])
  requireText("packages/opencode/src/tool/operation_resume.ts", operationResume, ["recoverStaleTasks", "maxRecoveries"])
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
    "operation_recover",
    "operation_stage_gate",
    "operation_status",
    "runtime_summary",
    "task_restart",
  ]) {
    assert(await exists(`packages/opencode/src/tool/${tool}.ts`), `${tool}.ts is missing`)
    assert(await exists(`packages/opencode/src/tool/${tool}.txt`), `${tool}.txt is missing`)
  }
  return { id: "operation_runtime", status: "ok", detail: "durable runtime, resume, recovery, and stage tools are wired" } satisfies CheckResult
}

async function auditReportQuality() {
  const artifact = await read("packages/opencode/src/ulm/artifact.ts")
  const reportLint = await read("packages/opencode/src/tool/report_lint.ts")
  const tests = await read("packages/opencode/test/ulm/artifact.test.ts")
  const longReportSkill = await read("tools/ulmcode-profile/skills/pentest-compact/k12-long-report-production/SKILL.md")
  requireText("packages/opencode/src/ulm/artifact.ts", artifact, [
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
  requireText("tools/ulmcode-profile/package.json", profilePackage, [
    "file:plugins/vendor/oh-my-openagent-3.17.12",
    "oh-my-openagent",
    "oh-my-opencode",
  ])
  assert(!opencodeConfig.includes("oh-my-openagent@latest"), "profile must not use oh-my-openagent@latest")
  requireText("tools/ulmcode-profile/plugins/ulmcode-runtime-guard.js", guard, [
    "operation_resume",
    "runtime_summary",
    "operation_recover",
    "report_lint",
  ])
  requireText("tools/ulmcode-profile/scripts/install-profile.sh", installer, [
    "ulmcode-launch.sh",
    "oh-my-openagent.jsonc",
    "local-opencode",
  ])
  assert(
    await exists("tools/ulmcode-profile/plugins/vendor/oh-my-openagent-3.17.12/dist/index.js"),
    "vendored oh-my-openagent dist is missing",
  )
  return { id: "profile_runtime", status: "ok", detail: "isolated profile, runtime guard, and vendored plugins are wired" } satisfies CheckResult
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
  ]) {
    assert(labs.includes(id), `lab catalog missing ${id}`)
  }
  assert(labs.length >= 15, `expected at least 15 bundled labs, found ${labs.length}`)
  assert(
    manifests.some((manifest) => (manifest.findings?.length ?? 0) >= 2),
    "expected at least one bundled multi-finding lab",
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
  ]) {
    assert(typeof scripts[script] === "string", `package script ${script} is missing`)
  }
  const profileVerifier = await read("tools/ulmcode-profile/test-profile.sh")
  requireText("tools/ulmcode-profile/test-profile.sh", profileVerifier, [
    "test:ulm-smoke",
    "test:ulm-skills",
    "test:ulm-lab",
    "test:ulm-lab-target",
  ])
  return { id: "required_gates", status: "ok", detail: "package and profile verifier scripts include the ULM gates" } satisfies CheckResult
}

const checks: CheckResult[] = [
  await auditUpstream(),
  await auditOperationRuntime(),
  await auditReportQuality(),
  await auditProfileRouting(),
  await auditProfileRuntime(),
  await auditLabCatalog(),
  await auditRequiredGates(),
]

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
