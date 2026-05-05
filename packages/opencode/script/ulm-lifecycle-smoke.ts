#!/usr/bin/env bun

import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  formatOperationStatusDashboard,
  lintReport,
  readOperationStatus,
  renderReport,
  writeEvidence,
  writeFinding,
  writeOperationCheckpoint,
  writeOperationPlan,
  writeReportOutline,
  writeRuntimeSummary,
} from "../src/ulm/artifact"

const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-lifecycle-smoke-"))
const operationID = "school-assessment"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

await writeOperationCheckpoint(worktree, {
  operationID,
  objective: "Authorized school assessment smoke test",
  stage: "intake",
  status: "planned",
  summary: "Smoke test initialized the operation ledger.",
  nextActions: ["Write the operation plan", "Record evidence", "Render final deliverables"],
  riskLevel: "medium",
})

await writeOperationPlan(worktree, {
  operationID,
  assumptions: ["This is a local smoke test with synthetic evidence."],
  phases: [
    {
      stage: "recon",
      objective: "Record a scoped evidence artifact.",
      actions: ["Capture the synthetic policy export"],
      successCriteria: ["Evidence is stored under the operation folder"],
      subagents: ["recon"],
      noSubagents: ["authorization decisions stay with the primary operator"],
    },
    {
      stage: "reporting",
      objective: "Produce final handoff artifacts.",
      actions: ["Run report_lint", "Run report_render", "Run runtime_summary"],
      successCriteria: ["Final handoff lint passes"],
      subagents: ["report-writer"],
      noSubagents: ["final acceptance remains with the primary operator"],
    },
  ],
  reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
})

await writeOperationCheckpoint(worktree, {
  operationID,
  objective: "Authorized school assessment smoke test",
  stage: "validation",
  status: "running",
  summary: "Synthetic validation confirmed one report-ready issue.",
  activeTasks: ["task-smoke-recon"],
  riskLevel: "high",
})

await writeEvidence(worktree, {
  operationID,
  evidenceID: "ev-idp-policy",
  title: "IdP policy export",
  kind: "command_output",
  summary: "Synthetic policy output shows privileged MFA is optional.",
  command: "idpctl policy export --json",
  content: '{"privilegedMfa":"optional"}',
})

await writeFinding(worktree, {
  operationID,
  findingID: "weak-mfa-coverage",
  title: "Weak MFA coverage",
  state: "report_ready",
  severity: "high",
  confidence: 0.9,
  affectedAssets: ["IdP"],
  evidence: [{ id: "ev-idp-policy", path: "evidence/raw/idp-policy-export.txt" }],
  description: "Privileged MFA is not consistently enforced in the synthetic policy export.",
  impact: "Privileged account compromise is more likely after password theft.",
  remediation: "Require phishing-resistant MFA for all privileged accounts.",
})

await writeReportOutline(worktree, {
  operationID,
  audience: "mixed",
  targetPages: 40,
  includeAppendix: true,
})

await writeOperationCheckpoint(worktree, {
  operationID,
  objective: "Authorized school assessment smoke test",
  stage: "handoff",
  status: "complete",
  summary: "Smoke test rendered final artifacts and is ready for handoff.",
  nextActions: ["Review final manifest"],
  riskLevel: "high",
})

const rendered = await renderReport(worktree, {
  operationID,
  title: "ULMCode Smoke Assessment Report",
})

const runtime = await writeRuntimeSummary(worktree, {
  operationID,
  sessionMessages: [
    {
      role: "assistant",
      agent: "pentest",
      modelID: "gpt-5.5",
      providerID: "openai",
      cost: 0.42,
      tokens: {
        input: 1200,
        output: 600,
        reasoning: 300,
        cache: { read: 100, write: 0 },
      },
    },
    {
      role: "assistant",
      agent: "report-writer",
      modelID: "gpt-5.5",
      providerID: "openai",
      cost: 0.31,
      tokens: {
        input: 900,
        output: 700,
        reasoning: 200,
        cache: { read: 0, write: 0 },
      },
    },
  ],
  backgroundTasks: [{ id: "task-smoke-recon", agent: "recon", status: "completed", summary: "Synthetic recon complete." }],
  compaction: { count: 0, pressure: "low" },
  notes: ["Smoke test generated all final handoff artifacts."],
})

const finalLint = await lintReport(worktree, operationID, { finalHandoff: true })
assert(finalLint.ok, `final handoff lint failed: ${finalLint.gaps.join("; ")}`)

const status = await readOperationStatus(worktree, operationID)
const dashboard = formatOperationStatusDashboard(status)
assert(dashboard.includes("# school-assessment - handoff/complete"), "dashboard did not include final handoff state")
assert(status.reports.pdf, "status did not detect final PDF")
assert(status.runtimeSummary, "status did not detect runtime summary")

const manifest = JSON.parse(await fs.readFile(rendered.manifest, "utf8")) as {
  counts?: { reportableFindings?: number; evidence?: number }
  artifacts?: { pdf?: string; runtimeSummary?: string }
}
assert(manifest.counts?.reportableFindings === 1, "manifest did not record one reportable finding")
assert(manifest.counts?.evidence === 1, "manifest did not record one evidence item")

console.log("ulm_lifecycle_smoke: ok")
console.log(`operation: ${operationID}`)
console.log("final_lint: ok")
console.log(`report.pdf: ${rendered.pdf}`)
console.log(`runtime-summary.json: ${runtime.json}`)
console.log(`manifest.json: ${rendered.manifest}`)
