import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Bus } from "@/bus"
import { WithInstance } from "@/project/with-instance"
import {
  buildOperationAudit,
  buildOperationResumeBrief,
  buildOperationStageGate,
  formatOperationStatusDashboard,
  formatOperationResumeBrief,
  listOperationStatuses,
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
import { OperationEvent } from "@/ulm/event"
import { disposeAllInstances } from "../fixture/fixture"

async function tmpdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ulm-artifact-"))
}

describe("ULM artifact ledger", () => {
  afterEach(() => disposeAllInstances())

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

  test("publishes operation update events after durable writes", async () => {
    const worktree = await tmpdir()
    const received: Array<{ operationID: string; artifact: string; path?: string }> = []

    await WithInstance.provide({
      directory: worktree,
      fn: async () => {
        Bus.subscribe(OperationEvent.Updated, (evt) => {
          received.push(evt.properties)
        })
        await Bun.sleep(10)
        await writeOperationCheckpoint(worktree, {
          operationID: "School Assessment",
          objective: "Authorized school assessment",
          stage: "recon",
          status: "running",
          summary: "Recon lane started.",
        })
        await Bun.sleep(10)
      },
    })

    expect(received).toContainEqual(
      expect.objectContaining({
        operationID: "school-assessment",
        artifact: "checkpoint",
        operation: expect.objectContaining({
          stage: "recon",
          status: "running",
          summary: "Recon lane started.",
        }),
        findings: { total: 0 },
        evidence: { total: 0 },
      }),
    )
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

  test("lints reports that miss the outline page budget", async () => {
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

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(path.join(outline.root, "reports", "report.md"), `# Report\n\n${"detail ".repeat(150)}`)

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      requireOutlineBudget: true,
      minOutlineWordsPerPage: 100,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("report misses outline budget: 152 words, expected at least 400 for 4 target pages")
  })

  test("lints missing outline report sections even when total report is long", async () => {
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

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(
      path.join(outline.root, "reports", "report.md"),
      ["# Report", "", "## Methodology", "methodology ".repeat(500)].join("\n"),
    )

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      requireOutlineSections: true,
      minOutlineSectionWords: 25,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("Executive Summary: outline section is missing")
  })

  test("lints sparse outline report sections even when total report is long", async () => {
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

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(
      path.join(outline.root, "reports", "report.md"),
      [
        "# Report",
        "",
        "## Executive Summary",
        "Too thin.",
        "",
        "## Scope, Authorization, and Methodology",
        "methodology ".repeat(500),
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      requireOutlineSections: true,
      minOutlineSectionWords: 25,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("Executive Summary: outline section is too sparse: 2 words, expected at least 25")
  })

  test("lints sparse per-finding report sections even when total report is long", async () => {
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

    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report.md"),
      [
        "# Report",
        "",
        "## Methodology",
        "methodology ".repeat(150),
        "",
        "## Weak MFA coverage",
        "Admins lack MFA.",
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      minWords: 100,
      requireFindingSections: true,
      minFindingWords: 50,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("weak-mfa-coverage: report section is too sparse: 3 words, expected at least 50")
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

  test("lists operation statuses for CLI dashboards", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "beta",
      objective: "Beta school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon running.",
    })
    await writeOperationCheckpoint(worktree, {
      operationID: "alpha",
      objective: "Alpha school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Handoff complete.",
    })

    const statuses = await listOperationStatuses(worktree)
    expect(statuses.map((status) => status.operationID)).toEqual(["alpha", "beta"])
    expect(statuses[0]?.operation?.status).toBe("complete")
    expect(statuses[1]?.operation?.stage).toBe("recon")
  })

  test("formats a compact operation status dashboard", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      riskLevel: "high",
      summary: "Validation running.",
      nextActions: ["Promote confirmed findings"],
      blockers: ["Waiting on VPN window"],
      activeTasks: ["task-recon-1"],
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
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 3, byModel: { "gpt-5.5": 2, "gpt-5.4-mini": 1 } },
      usage: { totalTokens: 4200, costUSD: 0.75, remainingUSD: 9.25 },
      backgroundTasks: [
        { id: "task-recon-1", agent: "recon", status: "running", summary: "Enumerating login surface." },
      ],
      notes: ["runtime blind spot: background task task-old has no readable session ledger."],
    })

    const dashboard = formatOperationStatusDashboard(await readOperationStatus(worktree, "school"))
    expect(dashboard).toContain("school - validation/running")
    expect(dashboard).toContain("risk: high")
    expect(dashboard).toContain("findings: 1 total")
    expect(dashboard).toContain("evidence: 1 total")
    expect(dashboard).toContain("runtime: 3 calls, 4200 tokens, $0.75")
    expect(dashboard).toContain("models: gpt-5.5=2, gpt-5.4-mini=1")
    expect(dashboard).toContain("- task-recon-1 running (recon)")
    expect(dashboard).toContain("runtime_notes:")
    expect(dashboard).toContain("- runtime blind spot: background task task-old has no readable session ledger.")
    expect(dashboard).toContain("blockers:")
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
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
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
    await writeFinding(worktree, {
      operationID: "school",
      title: "Legacy TLS suspicion",
      state: "rejected",
      severity: "medium",
      confidence: 0.2,
      affectedAssets: ["vpn.example.edu"],
      evidence: [],
      description: "Initial suspicion was rejected during validation.",
    })

    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const html = await fs.readFile(result.html, "utf8")
    expect(html).toContain("Weak MFA coverage")
    expect(html).toContain("Evidence Index")
    expect(html).toContain("Legacy TLS suspicion")
    expect(await fs.readFile(result.pdf, "utf8")).toStartWith("%PDF-")
    const readme = await fs.readFile(result.readme, "utf8")
    expect(readme).toContain("Assessment Report")
    expect(readme).toContain("Non-Reportable Findings")
    const manifest = JSON.parse(await fs.readFile(result.manifest, "utf8"))
    expect(manifest.findings).toEqual(["weak-mfa-coverage"])
    expect(manifest.nonReportableFindings).toEqual(["legacy-tls-suspicion"])
    expect(manifest.artifacts.operationPlan).toContain("operation-plan.json")
    expect(manifest.counts.findings).toBe(2)
    expect(manifest.counts.reportableFindings).toBe(1)
    expect(manifest.counts.byState.rejected).toBe(1)
    expect(manifest.counts.evidence).toBe(1)
    const status = await readOperationStatus(worktree, "school")
    expect(status.reports.pdf).toBe(true)
    expect(status.reports.readme).toBe(true)
    expect(status.reports.manifest).toBe(true)

    await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 5, byModel: { "gpt-5.5": 5 } },
      compaction: { count: 0, pressure: "low" },
      fetches: { total: 2, repeatedTargets: [] },
      backgroundTasks: [],
    })
    const handoffLint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(handoffLint.ok).toBe(true)
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
      usage: {
        inputTokens: 9000,
        outputTokens: 3000,
        reasoningTokens: 1500,
        totalTokens: 13500,
        costUSD: 2.45,
        budgetUSD: 10,
        remainingUSD: 7.55,
        byAgent: {
          pentest: { calls: 5, totalTokens: 8000, costUSD: 1.6 },
          recon: { calls: 7, totalTokens: 5500, costUSD: 0.85 },
        },
      },
      compaction: { count: 2, pressure: "moderate", lastSummary: "Earlier recon was compacted." },
      fetches: { total: 9, repeatedTargets: ["https://example.edu/login"] },
      backgroundTasks: [
        { id: "task-recon-1", agent: "recon", status: "running", summary: "Enumerating login surface." },
      ],
      notes: ["Continue from operation_status before launching new lanes."],
    })

    expect(JSON.parse(await fs.readFile(result.json, "utf8")).modelCalls.byModel["gpt-5.5"]).toBe(8)
    expect(JSON.parse(await fs.readFile(result.json, "utf8")).usage.byAgent.pentest.totalTokens).toBe(8000)
    const markdown = await fs.readFile(result.markdown, "utf8")
    expect(markdown).toContain("task-recon-1")
    expect(markdown).toContain("tokens_total: 13500")
    expect(markdown).toContain("pentest: 5 calls, 8000 tokens, $1.6")
    const status = await readOperationStatus(worktree, "school")
    expect(status.runtimeSummary).toBe(true)
    expect(status.runtime?.usage?.remainingUSD).toBe(7.55)
    expect(status.runtime?.backgroundTasks?.[0]?.id).toBe("task-recon-1")
  })

  test("builds restart-ready operation resume briefs", async () => {
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
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 3, byModel: { "gpt-5.5": 2, "gpt-5.4-mini": 1 } },
      usage: { totalTokens: 4200, costUSD: 0.85 },
      backgroundTasks: [
        { id: "task-recon-1", agent: "recon", status: "running", summary: "Enumerating login surface." },
      ],
    })

    const brief = await buildOperationResumeBrief(worktree, "school")
    expect(brief.operationID).toBe("school")
    expect(brief.checkpoint?.stage).toBe("validation")
    expect(brief.health.ready).toBe(false)
    expect(brief.health.gaps).toContain("operation plan is missing")
    expect(brief.recommendedTools).toContain("operation_status")
    expect(brief.recommendedTools).toContain("operation_plan")
    expect(brief.recommendedTools).toContain("task_list")
    expect(brief.recommendedTools).toContain("task_status")
    expect(brief.continuationPrompt).toContain("Resume ULMCode operation school")
    expect(brief.continuationPrompt).toContain("Finish exploit reproduction")

    const markdown = formatOperationResumeBrief(brief)
    expect(markdown).toStartWith("# Resume school")
    expect(markdown).toContain("health: attention_required")
    expect(markdown).toContain("task-recon-1 running (recon) - Enumerating login surface.")
    expect(markdown).toContain("operation_status")
    expect(markdown).toContain("task_list operationID=school")
  })

  test("marks stale running operations and tasks in resume briefs", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
      nextActions: ["Check stale subagent output"],
      activeTasks: ["task-recon-1"],
    })
    const operationFile = path.join(worktree, ".ulmcode", "operations", "school", "operation.json")
    const operation = JSON.parse(await fs.readFile(operationFile, "utf8"))
    operation.time.updated = "2026-05-05T12:00:00.000Z"
    await fs.writeFile(operationFile, JSON.stringify(operation, null, 2) + "\n")
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      backgroundTasks: [
        {
          id: "task-recon-1",
          agent: "recon",
          status: "stale",
          summary: "No heartbeat after scan launch.",
          restartArgs: {
            task_id: "task-recon-1",
            background: true,
            description: "restart recon lane",
            prompt: "resume recon lane",
            subagent_type: "recon",
            operationID: "school",
          },
        },
      ],
    })

    const brief = await buildOperationResumeBrief(worktree, "school", {
      now: "2026-05-05T14:30:00.000Z",
      staleAfterMinutes: 60,
    })

    expect(brief.health.ready).toBe(false)
    expect(brief.health.gaps).toContain("operation checkpoint is stale: last update was 150 minutes ago")
    expect(brief.health.gaps).toContain("background task task-recon-1 is stale")
    expect(brief.recommendedTools).toContain("operation_checkpoint")
    expect(brief.recommendedTools).toContain("task_status")
    expect(brief.recommendedTools).toContain("operation_recover")
    expect(brief.recommendedTools).toContain("task_restart")
    expect(formatOperationResumeBrief(brief)).toContain("operation checkpoint is stale")
    expect(formatOperationResumeBrief(brief)).toContain("operation_recover operationID=school")
    expect(formatOperationResumeBrief(brief)).toContain("task_restart task_id=task-recon-1")
    expect(formatOperationResumeBrief(brief)).toContain('"prompt":"resume recon lane"')
  })

  test("marks exhausted operation budgets in resume briefs", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
      nextActions: ["Continue validation"],
    })
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      usage: {
        totalTokens: 12_500,
        costUSD: 12.4,
        budgetUSD: 10,
        remainingUSD: -2.4,
      },
    })

    const brief = await buildOperationResumeBrief(worktree, "school")

    expect(brief.health.ready).toBe(false)
    expect(brief.health.gaps).toContain("runtime budget exhausted: spent $12.4 of $10")
    expect(brief.recommendedTools).toContain("runtime_summary")
    expect(formatOperationResumeBrief(brief)).toContain("runtime budget exhausted")
  })

  test("writes durable operation audits for final handoff gates", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
      nextActions: ["Review final package"],
    })

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.blockers).toContain("resume: operation plan is missing")
    expect(audit.blockers).toContain("final_handoff: plans/operation-plan.json is required")
    expect(audit.recommendedTools).toContain("operation_plan")
    expect(audit.recommendedTools).toContain("report_lint")
    expect(audit.recommendedTools).toContain("report_render")
    expect(audit.recommendedTools).toContain("runtime_summary")
    expect(JSON.parse(await fs.readFile(audit.files.json, "utf8")).operationID).toBe("school")
    expect(await fs.readFile(audit.files.markdown, "utf8")).toContain("final_handoff: attention_required")
  })

  test("operation audit forwards strict outline section gates", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
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

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(
      path.join(outline.root, "reports", "report.md"),
      ["# Report", "", "## Methodology", "methodology ".repeat(500)].join("\n"),
    )

    const audit = await buildOperationAudit(worktree, "school", {
      finalHandoff: true,
      requireOutlineSections: true,
      minOutlineSectionWords: 25,
    })

    expect(audit.ok).toBe(false)
    expect(audit.blockers).toContain("final_handoff: Executive Summary: outline section is missing")
    expect(audit.recommendedTools).toContain("report_outline")
  })

  test("blocks validation stage gates until findings are report-ready", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is reviewing evidence.",
      nextActions: ["Validate candidate findings"],
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      phases: [
        {
          stage: "validation",
          objective: "Validate candidate weaknesses.",
          actions: ["Check evidence", "Promote confirmed findings"],
          successCriteria: ["Confirmed findings cite evidence"],
          subagents: ["validator"],
          noSubagents: ["risk acceptance stays with primary operator"],
        },
      ],
      reportingCloseout: [
        "Run report_lint before final handoff.",
        "Run report_render to produce final deliverables.",
        "Run runtime_summary and operation_audit before handoff.",
      ],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "Policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "candidate",
      severity: "high",
      confidence: 0.6,
      affectedAssets: ["IdP"],
      evidence: [],
      description: "MFA may not be enforced for administrators.",
    })

    const gate = await buildOperationStageGate(worktree, "school", { stage: "validation" })

    expect(gate.ok).toBe(false)
    expect(gate.gaps).toContain("validation has no validated or report-ready findings")
    expect(gate.gaps).toContain("validation has unresolved candidate or needs-validation findings")
    expect(gate.recommendedTools).toContain("finding_record")
    expect(JSON.parse(await fs.readFile(gate.files.json, "utf8")).stage).toBe("validation")
    expect(await fs.readFile(gate.files.markdown, "utf8")).toContain("validation has no validated")
  })

  test("derives runtime usage from assistant messages when usage is not provided", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
    })

    const result = await writeRuntimeSummary(worktree, {
      operationID: "school",
      sessionMessages: [
        {
          role: "assistant",
          agent: "pentest",
          modelID: "gpt-5.5",
          providerID: "openai",
          cost: 1.25,
          tokens: {
            input: 3000,
            output: 1200,
            reasoning: 500,
            cache: { read: 200, write: 100 },
          },
        },
        {
          role: "assistant",
          agent: "recon",
          modelID: "gpt-5.4-mini",
          providerID: "openai",
          cost: 0.15,
          tokens: {
            total: 1800,
            input: 1000,
            output: 600,
            reasoning: 100,
            cache: { read: 100, write: 0 },
          },
        },
        {
          role: "user",
          agent: "user",
        },
      ],
      compaction: { count: 0, pressure: "low" },
    })

    const record = JSON.parse(await fs.readFile(result.json, "utf8"))
    expect(record.modelCalls.total).toBe(2)
    expect(record.modelCalls.byModel["gpt-5.5"]).toBe(1)
    expect(record.modelCalls.byModel["gpt-5.4-mini"]).toBe(1)
    expect(record.usage.inputTokens).toBe(4000)
    expect(record.usage.outputTokens).toBe(1800)
    expect(record.usage.reasoningTokens).toBe(600)
    expect(record.usage.cacheReadTokens).toBe(300)
    expect(record.usage.cacheWriteTokens).toBe(100)
    expect(record.usage.totalTokens).toBe(6500)
    expect(record.usage.costUSD).toBe(1.4)
    expect(record.usage.byAgent.pentest.calls).toBe(1)
    expect(record.usage.byAgent.pentest.totalTokens).toBe(4700)
    expect(record.usage.byAgent.recon.costUSD).toBe(0.15)
  })

  test("computes remaining runtime budget from derived usage", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
    })

    const result = await writeRuntimeSummary(worktree, {
      operationID: "school",
      usage: { budgetUSD: 1 },
      sessionMessages: [
        {
          role: "assistant",
          agent: "validator",
          modelID: "gpt-5.5",
          providerID: "openai",
          cost: 0.37,
          tokens: {
            input: 500,
            output: 150,
            reasoning: 100,
            cache: { read: 0, write: 0 },
          },
        },
      ],
    })

    const record = JSON.parse(await fs.readFile(result.json, "utf8"))
    expect(record.usage.costUSD).toBe(0.37)
    expect(record.usage.budgetUSD).toBe(1)
    expect(record.usage.remainingUSD).toBe(0.63)
    expect(await fs.readFile(result.markdown, "utf8")).toContain("- remaining_usd: 0.63")
  })

  test("derives compaction pressure from session messages when compaction is not provided", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
    })

    const result = await writeRuntimeSummary(worktree, {
      operationID: "school",
      sessionMessages: [
        { role: "user", parts: [{ type: "compaction", auto: true, overflow: true }] },
        { role: "assistant", summary: true },
        { role: "user", parts: [{ type: "compaction", auto: true }] },
      ],
    })

    const record = JSON.parse(await fs.readFile(result.json, "utf8"))
    expect(record.compaction.count).toBe(2)
    expect(record.compaction.pressure).toBe("moderate")
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

  test("rejects vague operation plans", async () => {
    const worktree = await tmpdir()
    await expect(
      writeOperationPlan(worktree, {
        operationID: "school",
        phases: [
          {
            stage: "recon",
            objective: "Look around.",
            actions: [],
            successCriteria: [],
            subagents: [],
            noSubagents: [],
          },
        ],
        reportingCloseout: ["Write report."],
      }),
    ).rejects.toThrow("phase 1 requires at least one action")
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
      finalHandoff: true,
    })

    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("plans/operation-plan.json is required")
    expect(result.gaps).toContain("deliverables/final/report.pdf is required")
    expect(result.gaps).toContain("deliverables/final/README.md is required")
    expect(result.gaps).toContain("deliverables/runtime-summary.json is required")
  })
})
