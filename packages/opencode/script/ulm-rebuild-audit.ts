#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

const packageRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(packageRoot, "../..")

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

async function auditUpstream() {
  const right = await run(["git", "rev-list", "--right-only", "--count", "HEAD...upstream/dev"])
  assert(right === "0", `branch is behind upstream/dev by ${right} commits`)
  return "upstream_current: ok"
}

async function auditOperationRuntime() {
  const registry = await read("packages/opencode/src/tool/registry.ts")
  const artifact = await read("packages/opencode/src/ulm/artifact.ts")
  const operationResume = await read("packages/opencode/src/tool/operation_resume.ts")
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
  return "operation_runtime: ok"
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
  ])
  requireText("tools/ulmcode-profile/skills/pentest-compact/k12-long-report-production/SKILL.md", longReportSkill, [
    "requireOutlineBudget: true",
    "requireOutlineSections: true",
    "requireFindingSections: true",
  ])
  return "report_quality: ok"
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
  return "profile_runtime: ok"
}

async function auditLabCatalog() {
  const labs = await labManifestIDs()
  for (const id of [
    "k12-login-mfa-gap",
    "k12-lms-payment-webhook-replay",
    "k12-family-messaging-cross-class-broadcast",
    "k12-third-party-integration-token-leak",
  ]) {
    assert(labs.includes(id), `lab catalog missing ${id}`)
  }
  assert(labs.length >= 15, `expected at least 15 bundled labs, found ${labs.length}`)
  for (const id of labs) {
    assert(await exists(`tools/ulmcode-labs/${id}/service/server.js`), `${id}: service/server.js is missing`)
    assert(await exists(`tools/ulmcode-labs/${id}/docker-compose.yml`), `${id}: docker-compose.yml is missing`)
  }
  return `lab_catalog: ok (${labs.length})`
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
  return "required_gates: ok"
}

const checks = [
  await auditUpstream(),
  await auditOperationRuntime(),
  await auditReportQuality(),
  await auditProfileRuntime(),
  await auditLabCatalog(),
  await auditRequiredGates(),
]

console.log("ulm_rebuild_audit: ok")
for (const check of checks) console.log(check)
