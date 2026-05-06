#!/usr/bin/env bun

import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  buildOperationAudit,
  buildOperationStageGate,
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
  type EvidenceInput,
  type FindingInput,
  type OperationPlanInput,
  type RuntimeSummaryInput,
} from "../src/ulm/artifact"
import { writeOperationGraph } from "../src/ulm/operation-graph"

type LabManifest = {
  id: string
  operationID: string
  objective: string
  assumptions?: string[]
  plan: Omit<OperationPlanInput, "operationID">
  evidence: Array<Omit<EvidenceInput, "operationID">>
  findings: Array<Omit<FindingInput, "operationID">>
  runtime?: Omit<RuntimeSummaryInput, "operationID">
  report?: {
    targetPages?: number
    minOutlineWordsPerPage?: number
    minOutlineSectionWords?: number
    authoredMarkdownFile?: string
  }
  expected?: {
    reportableFindings?: number
    evidence?: number
    dashboardIncludes?: string[]
    reportIncludes?: string[]
    pdfIncludes?: string[]
  }
}

const repoRoot = path.resolve(import.meta.dir, "../../..")
const defaultLab = path.join(repoRoot, "tools", "ulmcode-labs", "k12-login-mfa-gap", "manifest.json")
const labPath = path.resolve(process.argv[2] ?? defaultLab)
const lab = JSON.parse(await fs.readFile(labPath, "utf8")) as LabManifest
const labRoot = path.dirname(labPath)
const worktree = await fs.mkdtemp(path.join(os.tmpdir(), `ulm-lab-${lab.id}-`))

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function completeGraphForHandoff(worktree: string, operationID: string) {
  const graph = await writeOperationGraph(worktree, { operationID, budgetUSD: 5 })
  const parsed = JSON.parse(await fs.readFile(graph.json, "utf8")) as { lanes: Array<{ id: string; status: string; expectedArtifacts: string[] }> }
  const root = path.join(worktree, ".ulmcode", "operations", graph.operationID)
  for (const lane of parsed.lanes) {
    lane.status = "complete"
    for (const artifact of lane.expectedArtifacts) {
      const target = path.join(root, artifact.replace(/\/+$/g, ""))
      if (artifact.endsWith("/")) {
        await fs.mkdir(target, { recursive: true })
        await fs.writeFile(path.join(target, ".keep"), "complete\n")
        continue
      }
      await fs.mkdir(path.dirname(target), { recursive: true })
      try {
        const stat = await fs.stat(target)
        if (stat.size > 0) continue
      } catch {}
      await fs.writeFile(
        target,
        artifact === "reports/report.md"
          ? [
              "# Lab Replay Report",
              "",
              "## Executive Summary",
              "complete ".repeat(40),
              "## Scope, Authorization, and Methodology",
              "complete ".repeat(40),
              "## Environment Overview",
              "complete ".repeat(40),
              "## Attack Path Narrative",
              "complete ".repeat(40),
              "## Findings Detail",
              "complete ".repeat(40),
              "## Risk Register and Prioritized Roadmap",
              "complete ".repeat(40),
              "## Validation Limits and Known Unknowns",
              "complete ".repeat(40),
              "## Evidence Map",
              "complete ".repeat(40),
              "## Appendix: Raw Evidence Index",
              "complete ".repeat(40),
            ].join("\n")
          : "complete\n",
      )
    }
  }
  await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2) + "\n")
  await fs.mkdir(path.join(root, "lane-complete"), { recursive: true })
  for (const lane of parsed.lanes) {
    await fs.writeFile(
      path.join(root, "lane-complete", `${lane.id}.json`),
      JSON.stringify(
        {
          operationID: graph.operationID,
          laneID: lane.id,
          status: "complete",
          completedAt: new Date().toISOString(),
          summary: `${lane.id} complete.`,
          artifacts: lane.expectedArtifacts,
        },
        null,
        2,
      ) + "\n",
    )
  }
}

await writeOperationCheckpoint(worktree, {
  operationID: lab.operationID,
  objective: lab.objective,
  stage: "intake",
  status: "planned",
  summary: `Loaded lab manifest ${lab.id}.`,
  nextActions: ["Replay evidence", "Record findings", "Render final handoff"],
  riskLevel: "medium",
})

await writeOperationPlan(worktree, {
  operationID: lab.operationID,
  assumptions: lab.assumptions,
  phases: lab.plan.phases,
  reportingCloseout: lab.plan.reportingCloseout,
})

await writeOperationCheckpoint(worktree, {
  operationID: lab.operationID,
  objective: lab.objective,
  stage: "validation",
  status: "running",
  summary: "Replaying lab evidence and expected findings.",
  activeTasks: [`lab:${lab.id}`],
  riskLevel: "high",
})

for (const evidence of lab.evidence) {
  await writeEvidence(worktree, { ...evidence, operationID: lab.operationID })
}

for (const finding of lab.findings) {
  await writeFinding(worktree, { ...finding, operationID: lab.operationID })
}

await writeReportOutline(worktree, {
  operationID: lab.operationID,
  audience: "mixed",
  targetPages: lab.report?.targetPages ?? 2,
  includeAppendix: true,
})

if (lab.report?.authoredMarkdownFile) {
  const authoredReport = await fs.readFile(path.resolve(labRoot, lab.report.authoredMarkdownFile), "utf8")
  const reportPath = path.join(worktree, ".ulmcode", "operations", lab.operationID, "reports", "report.md")
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, authoredReport)
}

const validationGate = await buildOperationStageGate(worktree, lab.operationID, { stage: "validation" })
assert(validationGate.ok, `validation stage gate failed: ${validationGate.gaps.join("; ")}`)

await writeOperationCheckpoint(worktree, {
  operationID: lab.operationID,
  objective: lab.objective,
  stage: "handoff",
  status: "complete",
  summary: `Lab ${lab.id} replay completed and final artifacts are ready.`,
  nextActions: ["Review final manifest"],
  riskLevel: "high",
})

const runtime = await writeRuntimeSummary(worktree, {
  operationID: lab.operationID,
  ...(lab.runtime ?? {}),
  backgroundTasks: [
    ...(lab.runtime?.backgroundTasks ?? []),
    { id: `lab:${lab.id}`, agent: "validator", status: "completed", summary: "Lab replay completed." },
  ],
})

const rendered = await renderReport(worktree, {
  operationID: lab.operationID,
  title: `ULMCode Lab Replay: ${lab.id}`,
})

await completeGraphForHandoff(worktree, lab.operationID)

const finalLint = await lintReport(worktree, lab.operationID, {
  finalHandoff: true,
  requireOutlineBudget: true,
  requireOutlineSections: true,
  minOutlineWordsPerPage: lab.report?.minOutlineWordsPerPage ?? 80,
  minOutlineSectionWords: lab.report?.minOutlineSectionWords ?? 15,
})
assert(finalLint.ok, `final handoff lint failed: ${finalLint.gaps.join("; ")}`)

const audit = await buildOperationAudit(worktree, lab.operationID, {
  finalHandoff: true,
  requireOutlineBudget: true,
  requireOutlineSections: true,
  minOutlineWordsPerPage: lab.report?.minOutlineWordsPerPage ?? 80,
  minOutlineSectionWords: lab.report?.minOutlineSectionWords ?? 15,
})
assert(audit.ok, `operation audit failed: ${audit.blockers.join("; ")}`)

const status = await readOperationStatus(worktree, lab.operationID)
const dashboard = formatOperationStatusDashboard(status)
for (const expected of lab.expected?.dashboardIncludes ?? []) {
  assert(dashboard.includes(expected), `dashboard missing expected text: ${expected}`)
}

const reportHtml = await fs.readFile(rendered.html, "utf8")
const reportPdf = await fs.readFile(rendered.pdf, "utf8")
for (const expected of lab.expected?.reportIncludes ?? []) {
  assert(reportHtml.includes(expected), `final report html missing expected text: ${expected}`)
}
for (const expected of lab.expected?.pdfIncludes ?? []) {
  assert(reportPdf.includes(expected), `final report pdf missing expected text: ${expected}`)
}

const manifest = JSON.parse(await fs.readFile(rendered.manifest, "utf8")) as {
  counts?: { reportableFindings?: number; evidence?: number }
}
if (lab.expected?.reportableFindings !== undefined) {
  assert(
    manifest.counts?.reportableFindings === lab.expected.reportableFindings,
    `expected ${lab.expected.reportableFindings} reportable findings, got ${manifest.counts?.reportableFindings}`,
  )
}
if (lab.expected?.evidence !== undefined) {
  assert(manifest.counts?.evidence === lab.expected.evidence, `expected ${lab.expected.evidence} evidence records`)
}

console.log("ulm_lab_replay: ok")
console.log(`lab: ${lab.id}`)
console.log(`operation: ${lab.operationID}`)
console.log("final_lint: ok")
console.log("operation_audit: ok")
console.log("operation_stage_gate: ok")
console.log(`report.pdf: ${rendered.pdf}`)
console.log(`runtime-summary.json: ${runtime.json}`)
console.log(`operation-audit.json: ${audit.files.json}`)
console.log(`validation-gate.json: ${validationGate.files.json}`)
console.log(`manifest.json: ${rendered.manifest}`)
