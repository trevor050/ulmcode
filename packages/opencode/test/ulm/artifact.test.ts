import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  lintReport,
  readOperationStatus,
  renderReport,
  validateFinding,
  writeFinding,
  writeEvidence,
  writeOperationCheckpoint,
  writeOperationPlan,
  writeReportOutline,
  writeRuntimeSummary,
} from "@/ulm/artifact"

async function tmpdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ulm-artifact-"))
}

describe("ULM artifact ledger", () => {
  test("writes resumable operation checkpoints", async () => {
    const worktree = await tmpdir()
    const result = await writeOperationCheckpoint(worktree, {
      operationID: "School Assessment",
      objective: "Authorized school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon lane started.",
      nextActions: ["Map exposed services"],
      activeTasks: ["task-1"],
      evidence: [{ id: "ev-1", path: "evidence/raw/nmap.txt", summary: "Initial scan" }],
    })

    expect(result.record.operationID).toBe("school-assessment")
    expect(await fs.readFile(path.join(result.root, "status.md"), "utf8")).toContain("Recon lane started.")
    expect(await fs.readFile(path.join(result.root, "events.jsonl"), "utf8")).toContain("\"type\":\"checkpoint\"")
  })

  test("requires evidence before validated findings", () => {
    const gaps = validateFinding({
      operationID: "school",
      title: "Weak MFA coverage",
      state: "validated",
      severity: "high",
      confidence: 0.8,
      affectedAssets: ["IdP"],
      evidence: [],
      description: "MFA is not enforced for administrators.",
    })

    expect(gaps).toContain("validated findings require at least one evidence reference")
  })

  test("writes durable evidence records and raw content", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon is collecting evidence.",
    })

    const result = await writeEvidence(worktree, {
      operationID: "school",
      title: "IdP policy export",
      kind: "command_output",
      summary: "Policy export shows privileged MFA is optional.",
      command: "idpctl policy export --json",
      content: "{\"adminMfa\":\"optional\"}",
    })

    expect(await fs.readFile(result.rawPath!, "utf8")).toContain("adminMfa")
    expect(JSON.parse(await fs.readFile(result.json, "utf8")).path).toBe("evidence/raw/idp-policy-export.txt")
    expect((await readOperationStatus(worktree, "school")).evidence.total).toBe(1)
  })

  test("lints findings before report handoff", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const result = await lintReport(worktree, "school")
    expect(result.ok).toBe(true)
    expect(result.counts.reportReady).toBe(1)
  })

  test("lints reportable findings that cite unrecorded evidence", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-missing", path: "evidence/raw/missing.txt" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const result = await lintReport(worktree, "school")
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("weak-mfa-coverage: evidence reference ev-missing is not recorded")
  })

  test("writes a dense report outline and catches sparse reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 40 })
    expect(await fs.readFile(outline.file, "utf8")).toContain("target_pages: 40")

    await fs.writeFile(path.join(outline.root, "reports", "report.md"), "too short")
    const result = await lintReport(worktree, "school", { requireReport: true, minWords: 100 })
    expect(result.ok).toBe(false)
    expect(result.gaps.some((gap) => gap.includes("too sparse"))).toBe(true)
  })

  test("reads operation status for resumable runs", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
    })

    const status = await readOperationStatus(worktree, "school")
    expect(status.operation?.stage).toBe("validation")
    expect(status.findings.total).toBe(0)
    expect(status.lastEvents).toHaveLength(1)
  })

  test("renders final report deliverables", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Testing identified one report-ready finding.",
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      assumptions: ["Testing is authorized."],
      phases: [
        {
          stage: "reporting",
          objective: "Finalize report.",
          actions: ["Render deliverables"],
          successCriteria: ["Manifest includes handoff artifacts"],
          subagents: ["report-writer"],
          noSubagents: ["risk acceptance"],
        },
      ],
      reportingCloseout: ["Run report_render"],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    expect(await fs.readFile(result.html, "utf8")).toContain("Weak MFA coverage")
    expect(await fs.readFile(result.pdf, "utf8")).toStartWith("%PDF-")
    const manifest = JSON.parse(await fs.readFile(result.manifest, "utf8"))
    expect(manifest.findings).toEqual(["weak-mfa-coverage"])
    expect(manifest.artifacts.operationPlan).toContain("operation-plan.json")
    expect(manifest.counts.evidence).toBe(1)
    expect((await readOperationStatus(worktree, "school")).reports.pdf).toBe(true)
  })

  test("writes runtime summaries for long operation handoff", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
      nextActions: ["Finish exploit reproduction", "Promote confirmed findings"],
      activeTasks: ["task-recon-1"],
    })

    const result = await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 12, byModel: { "gpt-5.5": 8, "gpt-5.4-mini": 4 } },
      compaction: { count: 2, pressure: "moderate", lastSummary: "Earlier recon was compacted." },
      fetches: { total: 9, repeatedTargets: ["https://example.edu/login"] },
      backgroundTasks: [
        { id: "task-recon-1", agent: "recon", status: "running", summary: "Enumerating login surface." },
      ],
      notes: ["Continue from operation_status before launching new lanes."],
    })

    expect(JSON.parse(await fs.readFile(result.json, "utf8")).modelCalls.byModel["gpt-5.5"]).toBe(8)
    expect(await fs.readFile(result.markdown, "utf8")).toContain("task-recon-1")
    expect((await readOperationStatus(worktree, "school")).runtimeSummary).toBe(true)
  })

  test("writes execution-ready operation plans with subagent policy", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "intake",
      status: "planned",
      summary: "Initial authorization captured.",
    })

    const result = await writeOperationPlan(worktree, {
      operationID: "school",
      assumptions: ["Testing is limited to approved school-owned systems."],
      phases: [
        {
          stage: "recon",
          objective: "Map externally exposed services.",
          actions: ["Enumerate DNS", "Identify login surfaces"],
          successCriteria: ["All in-scope hostnames are classified"],
          subagents: ["recon"],
          noSubagents: ["authorization decisions stay with primary operator"],
        },
        {
          stage: "reporting",
          objective: "Produce final report package.",
          actions: ["Run report_lint", "Render final deliverables"],
          successCriteria: ["HTML, PDF, manifest, and runtime summary exist"],
          subagents: ["report-writer"],
          noSubagents: ["final risk acceptance remains manual"],
        },
      ],
      reportingCloseout: [
        "Run report_outline before drafting.",
        "Run report_lint and fix all gaps.",
        "Run report_render and runtime_summary before handoff.",
      ],
    })

    expect(await fs.readFile(result.markdown, "utf8")).toContain("authorization decisions stay with primary operator")
    expect(JSON.parse(await fs.readFile(result.json, "utf8")).phases).toHaveLength(2)
    expect((await readOperationStatus(worktree, "school")).plans.operation).toBe(true)
  })

  test("lints missing final handoff artifacts when required", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for final handoff.",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const result = await lintReport(worktree, "school", {
      requireOperationPlan: true,
      requireRenderedDeliverables: true,
      requireRuntimeSummary: true,
    })

    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("plans/operation-plan.json is required")
    expect(result.gaps).toContain("deliverables/final/report.pdf is required")
    expect(result.gaps).toContain("deliverables/runtime-summary.json is required")
  })
})
