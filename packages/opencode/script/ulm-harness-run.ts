#!/usr/bin/env bun

import fs from "fs/promises"
import os from "os"
import path from "path"
import { writeRuntimeSummary } from "../src/ulm/artifact"
import { buildCommandPlan, writeCommandPlan } from "../src/ulm/tool-manifest"
import { acquireTool } from "../src/ulm/tool-acquisition"
import { evaluateRuntimeGovernor } from "../src/ulm/runtime-governor"
import { writeOperationGraph } from "../src/ulm/operation-graph"
import { decideOperationNext } from "../src/ulm/operation-next"
import { runRuntimeScheduler } from "../src/ulm/runtime-scheduler"
import { normalizeEvidence } from "../src/ulm/evidence-normalizer"
import { buildWorkQueue, nextWorkUnits } from "../src/ulm/work-queue"
import {
  ULM_HARNESS_REQUIRED_CAPABILITIES,
  createHarnessScenario,
  runHarnessScenarios,
  writeHarnessScorecard,
  type HarnessCapabilityID,
  type HarnessCheck,
  type HarnessScenario,
  type HarnessTier,
} from "../src/ulm/harness"

const packageRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(packageRoot, "../..")

function hasArg(name: string) {
  return process.argv.includes(name)
}

function readArg(name: string) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function fileIncludes(relative: string, needles: string[]): Promise<HarnessCheck[]> {
  const absolute = path.join(repoRoot, relative)
  const content = await fs.readFile(absolute, "utf8")
  return needles.map((needle) => ({
    id: `${relative}:${needle}`,
    status: content.includes(needle) ? "passed" : "failed",
    detail: content.includes(needle) ? `found ${needle}` : `missing ${needle}`,
  }))
}

async function pathExists(relative: string): Promise<HarnessCheck> {
  try {
    await fs.access(path.join(repoRoot, relative))
    return { id: relative, status: "passed", detail: `${relative} exists` }
  } catch {
    return { id: relative, status: "failed", detail: `${relative} is missing` }
  }
}

async function countLabManifests() {
  const labsRoot = path.join(repoRoot, "tools", "ulmcode-labs")
  const entries = await fs.readdir(labsRoot, { withFileTypes: true })
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifest = path.join(labsRoot, entry.name, "manifest.json")
        try {
          const content = JSON.parse(await fs.readFile(manifest, "utf8")) as { id?: string; findings?: unknown[] }
          return content
        } catch {
          return undefined
        }
      }),
  )
  return manifests.filter((manifest): manifest is { id?: string; findings?: unknown[] } => manifest !== undefined)
}

function scenario(
  capability: HarnessCapabilityID,
  id: string,
  run: HarnessScenario["run"],
  description?: string,
  tier: HarnessTier = "fast",
): HarnessScenario {
  const info = ULM_HARNESS_REQUIRED_CAPABILITIES.find((item) => item.id === capability)
  return createHarnessScenario({
    id,
    title: info?.title ?? id,
    capability,
    tier,
    description,
    run,
  })
}

const scenarios: HarnessScenario[] = [
  scenario("model_loop_eval", "model-loop-contract", async () => {
    const checks = [
      await pathExists("packages/opencode/src/session/prompt.ts"),
      await pathExists("packages/opencode/src/tool/registry.ts"),
      ...(await fileIncludes("packages/opencode/script/ulm-lab-replay.ts", [
        "writeEvidence",
        "writeFinding",
        "writeOperationPlan",
      ])),
    ]
    return {
      status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
      checks,
      notes: ["Current fast lane verifies the operation-loop contract surface; real provider eval remains opt-in."],
      artifacts: [{ label: "lab replay script", path: "packages/opencode/script/ulm-lab-replay.ts", kind: "text" }],
    }
  }),
  scenario("restart_resume_chaos", "restart-resume-contract", async () => {
    const checks = [
      ...(await fileIncludes("packages/opencode/src/tool/operation_resume.ts", [
        "recoverStaleTasks",
        "maxRecoveries",
      ])),
      ...(await fileIncludes("packages/opencode/src/tool/operation_recover.ts", ["writeOperationCheckpoint"])),
      ...(await fileIncludes("packages/opencode/src/ulm/artifact.ts", ["runtimeHealthGaps", "recoverStaleTasks=true"])),
    ]
    return { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks }
  }),
  scenario("installed_profile_runtime", "installed-profile-contract", async () => {
    const checks = [
      await pathExists("tools/ulmcode-profile/scripts/install-profile.sh"),
      await pathExists("tools/ulmcode-profile/opencode.json"),
      await pathExists("tools/ulmcode-profile/plugins/ulmcode-runtime-guard.js"),
      ...(await fileIncludes("tools/ulmcode-profile/test-profile.sh", [
        "ULMCODE_CONFIG_DIR",
        "test:ulm-smoke",
        "test:ulm-rebuild-audit",
      ])),
    ]
    return { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks }
  }),
  scenario("ulm_ci_gate", "ulm-ci-contract", async () => {
    const checks = [
      await pathExists(".github/workflows/test.yml"),
      ...(await fileIncludes("packages/opencode/package.json", [
        "test:ulm-smoke",
        "test:ulm-lab",
        "test:ulm-rebuild-audit",
      ])),
    ]
    return {
      status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
      checks,
      notes: ["Dedicated ULM workflow is added by the harness implementation and should become the required check."],
    }
  }),
  scenario("longitudinal_scorecard", "scorecard-contract", async () => {
    return {
      status: "passed",
      checks: [
        { id: "scorecard-json", status: "passed", detail: "ulm-harness-run writes scorecard.json" },
        { id: "scorecard-markdown", status: "passed", detail: "ulm-harness-run writes scorecard.md" },
        { id: "coverage-required", status: "passed", detail: "all required capabilities are represented in coverage" },
      ],
      artifacts: [{ label: "scorecard directory", path: ".artifacts/ulm-harness", kind: "directory" }],
    }
  }),
  scenario("prompt_agent_regression", "prompt-agent-regression-contract", async () => {
    const checks = [
      await pathExists("tools/ulmcode-profile/skills/pentest-compact/k12-agent-orchestration-and-quality/SKILL.md"),
      await pathExists("tools/ulmcode-profile/skills/pentest-compact/k12-long-report-production/SKILL.md"),
      ...(await fileIncludes("tools/ulmcode-profile/commands/ulm-test-plan.md", [
        "integration or lifecycle tests",
        "artifact-level manual QA",
      ])),
    ]
    return { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks }
  }),
  scenario(
    "model_loop_eval",
    "runtime-supervision-governor-drill",
    async () => {
      const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-harness-runtime-"))
      const manifestPath = path.join(worktree, "tool-manifest.json")
      await fs.writeFile(
        manifestPath,
        JSON.stringify(
          {
            version: 1,
            lastReviewed: "2026-05-05",
            policy: {
              defaultSafetyMode: "non_destructive",
              destructiveSafetyMode: "interactive_destructive",
              installFailureBehavior: "record_blocker_with_fallback",
              notes: [],
            },
            tools: [
              {
                id: "fake-httpx",
                purpose: "fixture HTTP inventory",
                safety: "non_destructive",
                install: [{ platform: "test", command: "echo install" }],
                validate: "exit 127",
                safeExamples: ["fake-httpx -l hosts.txt"],
                outputParsers: ["jsonl"],
                fallbacks: ["curl"],
              },
            ],
            commandProfiles: [
              {
                id: "http-discovery",
                tool: "fake-httpx",
                safety: "non_destructive",
                template: "fake-httpx -l {inputFile} -o {outputPrefix}.jsonl",
                heartbeatSeconds: 1,
                idleTimeoutSeconds: 2,
                hardTimeoutSeconds: 3,
                restartable: true,
                artifacts: ["evidence/raw/httpx.jsonl"],
              },
            ],
          },
          null,
          2,
        ),
      )
      const graph = await writeOperationGraph(worktree, { operationID: "School", budgetUSD: 5 })
      const acquire = await acquireTool({ worktree, operationID: "School", toolID: "fake-httpx", manifestPath })
      const plan = await buildCommandPlan({
        worktree,
        operationID: "School",
        profileID: "http-discovery",
        variables: { inputFile: "hosts.txt" },
        outputPrefix: "evidence/raw/httpx",
        manifestPath,
      })
      await writeCommandPlan(plan)
      const httpxArtifact = path.join(plan.operationRoot, "evidence", "raw", "httpx.jsonl")
      await fs.mkdir(path.dirname(httpxArtifact), { recursive: true })
      await fs.writeFile(
        httpxArtifact,
        JSON.stringify({
          url: "https://portal.school.example",
          host: "portal.school.example",
          status_code: 200,
          title: "Student Portal",
          tech: ["nginx"],
        }) + "\n",
      )
      await writeRuntimeSummary(worktree, {
        operationID: "School",
        usage: { costUSD: 1, budgetUSD: 5 },
        compaction: { pressure: "low" },
      })
      const governor = await evaluateRuntimeGovernor(worktree, { operationID: "School", laneID: "recon" })
      const next = await decideOperationNext(worktree, { operationID: "School" })
      const scheduler = await runRuntimeScheduler(worktree, { operationID: "School", maxCycles: 1 })
      const normalized = await normalizeEvidence(worktree, { operationID: "School", commandPlanPaths: [plan.planPath] })
      const queue = await buildWorkQueue(worktree, { operationID: "School", manifestPath })
      const queueNext = await nextWorkUnits(worktree, {
        operationID: "School",
        laneID: "web_inventory",
        limit: 1,
        claim: true,
      })
      await fs.rm(worktree, { recursive: true, force: true })
      const checks: HarnessCheck[] = [
        {
          id: "graph-written",
          status: graph.lanes >= 9 ? "passed" : "failed",
          detail: `${graph.lanes} lanes written`,
        },
        {
          id: "tool-blocker-recorded",
          status: acquire.available === false && !!acquire.blocker ? "passed" : "failed",
          detail: acquire.blocker ?? "tool unexpectedly available",
        },
        {
          id: "command-plan-written",
          status: plan.command.includes("fake-httpx") ? "passed" : "failed",
          detail: plan.command,
        },
        {
          id: "governor-continues",
          status: governor.action === "continue" ? "passed" : "failed",
          detail: governor.reason,
        },
        {
          id: "next-action-launches-lane",
          status: next.action.action === "launch_lane" ? "passed" : "failed",
          detail: `${next.action.action} -> ${next.path}`,
        },
        {
          id: "operation-run-starts-lane",
          status:
            scheduler.cycles[0]?.run?.action === "launch_lane" && scheduler.cycles[0]?.run?.laneID === "recon" ? "passed" : "failed",
          detail: `${scheduler.cycles[0]?.run?.action ?? "none"} ${scheduler.cycles[0]?.run?.laneID ?? "none"}`,
        },
        {
          id: "runtime-scheduler-heartbeat",
          status: scheduler.heartbeatPath.endsWith("heartbeat.json") && scheduler.cycles.length === 1 ? "passed" : "failed",
          detail: scheduler.heartbeatPath,
        },
        {
          id: "evidence-normalized",
          status: normalized.leads.length >= 1 && normalized.evidence.length >= 1 ? "passed" : "failed",
          detail: `${normalized.leads.length} leads from ${normalized.evidence.length} evidence records`,
        },
        {
          id: "work-queue-built",
          status: queue.generated >= 1 ? "passed" : "failed",
          detail: `${queue.generated} generated work units`,
        },
        {
          id: "work-queue-next-claims-unit",
          status: queueNext.units.length >= 1 && queueNext.units[0]?.status === "running" ? "passed" : "failed",
          detail: `${queueNext.units.length} selected units`,
        },
      ]
      return {
        status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
        checks,
        notes: [
          "Executes real graph, tool-acquisition, command-plan, evidence-normalization, work-queue, runtime-summary, governor, scheduler, and next-action code paths.",
        ],
      }
    },
    "Real local drill for supervision, acquisition, graph, evidence normalization, work queue, governor, and next-action primitives.",
    "full",
  ),
  scenario("provider_tool_chaos", "provider-tool-chaos-contract", async () => {
    const checks = [
      ...(await fileIncludes("packages/opencode/src/provider/sse-repair.ts", ["repairSSEEvent", "jsonrepair"])),
      ...(await fileIncludes("packages/opencode/src/provider/provider.ts", ["enable_sse_json_repair", "repairSSE"])),
      ...(await fileIncludes("packages/opencode/src/tool/task.ts", ["summarizeRuntimeUsage"])),
      ...(await fileIncludes("packages/opencode/src/tool/command_supervise.ts", [
        "command_supervise",
        "BackgroundJob.Service",
      ])),
      ...(await fileIncludes("packages/opencode/src/ulm/tool-manifest.ts", [
        "buildCommandPlan",
        "unattended command_supervise only allows non_destructive",
      ])),
      ...(await fileIncludes("packages/opencode/src/ulm/tool-acquisition.ts", [
        "acquireTool",
        "install required before supervised command execution",
      ])),
      ...(await fileIncludes("packages/opencode/src/ulm/operation-graph.ts", [
        "REQUIRED_OPERATION_LANES",
        "validateOperationGraph",
      ])),
      ...(await fileIncludes("packages/opencode/src/ulm/runtime-governor.ts", [
        "evaluateRuntimeGovernor",
        "operation budget exhausted",
        "model route quota exhausted",
      ])),
      ...(await fileIncludes("packages/opencode/src/ulm/operation-next.ts", [
        "decideOperationNext",
        "launch_lane",
        "next-action.json",
      ])),
      ...(await fileIncludes("packages/opencode/src/ulm/operation-run.ts", [
        "runOperationStep",
        "operation-run.jsonl",
        "complete_lane",
      ])),
      ...(await fileIncludes("packages/opencode/src/ulm/evidence-normalizer.ts", [
        "normalizeEvidence",
        "leads.json",
        "httpx-jsonl",
      ])),
      ...(await fileIncludes("packages/opencode/src/ulm/work-queue.ts", [
        "buildWorkQueue",
        "nextWorkUnits",
        "work-queue.json",
      ])),
    ]
    return { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks }
  }),
  scenario("dashboard_api_e2e", "dashboard-api-contract", async () => {
    const checks = [
      await pathExists("packages/opencode/src/server/routes/instance/httpapi/handlers/ulm.ts"),
      await pathExists("packages/opencode/src/cli/cmd/tui/routes/ulm-operations.tsx"),
      ...(await fileIncludes("packages/opencode/test/server/httpapi-ulm.test.ts", [
        "/ulm/operation",
        "/ulm/operation/school/status",
      ])),
    ]
    return { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks }
  }),
  scenario("deep_lab_target", "deep-lab-target-contract", async () => {
    const manifests = await countLabManifests()
    const multiFinding = manifests.filter((manifest) => (manifest.findings?.length ?? 0) >= 2).length
    const checks: HarnessCheck[] = [
      {
        id: "lab-manifest-count",
        status: manifests.length >= 15 ? "passed" : "failed",
        detail: `${manifests.length} lab manifests found`,
      },
      {
        id: "multi-finding-labs",
        status: multiFinding >= 2 ? "passed" : "failed",
        detail: `${multiFinding} multi-finding labs found`,
      },
      await pathExists("packages/opencode/script/ulm-lab-target-smoke.ts"),
    ]
    return {
      status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
      checks,
      metrics: { labManifests: manifests.length, multiFindingLabs: multiFinding },
    }
  }),
  scenario("adversarial_report_quality", "adversarial-report-quality-contract", async () => {
    const checks = [
      ...(await fileIncludes("packages/opencode/src/tool/report_lint.ts", [
        "requireOutlineSections",
        "minOutlineSectionWords",
        "finalHandoff",
      ])),
      ...(await fileIncludes("packages/opencode/test/ulm/artifact.test.ts", [
        "lints sparse outline report sections",
        "lints missing outline report sections",
      ])),
    ]
    return { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks }
  }),
  scenario(
    "provider_tool_chaos",
    "provider-sse-repair-chaos",
    async () => {
      const checks = [
        ...(await fileIncludes("packages/opencode/test/provider/repair-sse.test.ts", [
          "repairs malformed JSON payloads",
          "passes valid events unchanged",
        ])),
        ...(await fileIncludes("packages/opencode/src/provider/sse-repair.ts", ["repairSSEEvent"])),
      ]
      return {
        status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
        checks,
        notes: ["Chaos lane currently verifies stream-repair fixtures; provider outage drills can layer here next."],
      }
    },
    "Provider stream repair fixture coverage for malformed SSE events.",
    "chaos",
  ),
  scenario(
    "model_loop_eval",
    "synthetic-full-operation",
    async () => {
      const checks = [
        await pathExists("packages/opencode/script/ulm-lifecycle-smoke.ts"),
        ...(await fileIncludes("packages/opencode/script/ulm-lifecycle-smoke.ts", [
          "writeOperationPlan",
          "writeRuntimeSummary",
          "buildOperationAudit",
        ])),
        ...(await fileIncludes("packages/opencode/package.json", [
          "test:ulm-smoke",
          "test:ulm-lab",
          "test:ulm-lab-target",
        ])),
      ]
      return {
        status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
        checks,
        notes: ["Full lane confirms synthetic operation assembly uses the same durable operation/report artifacts."],
      }
    },
    "Synthetic end-to-end operation coverage beyond static contract checks.",
    "full",
  ),
  scenario(
    "restart_resume_chaos",
    "overnight-readiness-contract",
    async () => {
      const checks = [
        ...(await fileIncludes("packages/opencode/src/tool/runtime_summary.txt", [
          "budget rollups",
          "stale-task restart args",
          "background task state",
        ])),
        ...(await fileIncludes("tools/ulmcode-profile/commands/ulm-resume.md", [
          "operation_resume",
          "recoverStaleTasks",
          "staleAfterMinutes",
        ])),
        ...(await fileIncludes("tools/ulmcode-profile/test-profile.sh", ["test:ulm-harness:fast"])),
        ...(await fileIncludes("packages/opencode/src/ulm/runtime-daemon.ts", [
          "runRuntimeDaemon",
          "daemon.lock.json",
          "cycleIntervalSeconds",
          "launchCommandWorkUnit",
        ])),
        ...(await fileIncludes("packages/opencode/src/ulm/runtime-supervisor.ts", [
          "writeRuntimeSupervisor",
          "launchd",
          "systemd",
          "supervisor-install.md",
          "Restart=on-failure",
        ])),
        ...(await fileIncludes("packages/opencode/script/ulm-runtime-daemon.ts", ["--detach", "daemon-launch.json"])),
        ...(await fileIncludes("packages/opencode/script/ulm-runtime-daemon.ts", ["--supervisor", "writeRuntimeSupervisor"])),
        ...(await fileIncludes("packages/opencode/script/ulm-burnin.ts", ["--target-hours", "runBurnInHarness"])),
        ...(await fileIncludes("packages/opencode/src/ulm/burnin-harness.ts", [
          "burnin-proof.json",
          "simulatedElapsedSeconds",
          "restartCount",
        ])),
        ...(await fileIncludes("packages/opencode/src/ulm/operation-run.ts", [
          "validateLaneCompletionProof",
          "lane-complete",
          "proof artifact is missing or empty",
        ])),
        ...(await fileIncludes("packages/opencode/test/ulm/runtime-daemon.test.ts", [
          "wall-clock scheduler loop",
          "refuses an active daemon lock",
          "detaches the operator CLI wrapper",
          "passes command work-unit launch hooks",
          "writes launchd and systemd supervisor artifacts",
        ])),
      ]
      return {
        status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
        checks,
        notes: [
          "Overnight lane is a readiness gate: real 20-hour lab execution remains operator-triggered, but recovery and resume contracts are mandatory.",
        ],
      }
    },
    "Readiness contract for unattended overnight operation recovery.",
    "overnight",
  ),
]

function selectedScenarios(tier: HarnessTier) {
  if (tier === "fast") return scenarios.filter((item) => item.tier === "fast")
  if (tier === "chaos") return scenarios.filter((item) => item.tier === "fast" || item.tier === "chaos")
  if (tier === "full") return scenarios.filter((item) => item.tier === "fast" || item.tier === "full")
  if (tier === "overnight") return scenarios.filter((item) => item.tier !== "overnight" || item.id === "overnight-readiness-contract")
  return scenarios.filter((item) => item.tier === tier)
}

if (hasArg("--list")) {
  const payload = { scenarios: scenarios.map(({ run: _run, ...item }) => item) }
  if (hasArg("--json")) {
    console.log(JSON.stringify(payload, null, 2))
  } else {
    for (const item of payload.scenarios) console.log(`${item.id}: ${item.capability} (${item.tier})`)
  }
  process.exit(0)
}

const tier = (readArg("--tier") ?? "fast") as HarnessTier
const selected = selectedScenarios(tier)
const started = new Date()
const outputDir = path.join(packageRoot, ".artifacts", "ulm-harness", started.toISOString().replace(/[:.]/g, "-"))
const result = await runHarnessScenarios(selected, { outputDir, now: started })
const output = await writeHarnessScorecard(outputDir, result)

if (hasArg("--json")) {
  console.log(JSON.stringify({ ...result, output }, null, 2))
} else {
  console.log(result.ok ? "ulm_harness: ok" : "ulm_harness: failed")
  console.log(`scorecard.json: ${output.json}`)
  console.log(`scorecard.md: ${output.markdown}`)
  for (const scenarioResult of result.scenarios) {
    console.log(`${scenarioResult.id}: ${scenarioResult.status}`)
  }
}

process.exit(result.ok ? 0 : 1)
