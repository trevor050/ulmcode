import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { lintReport, validateFinding, writeFinding, writeOperationCheckpoint, writeReportOutline } from "@/ulm/artifact"

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

  test("lints findings before report handoff", async () => {
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

    const result = await lintReport(worktree, "school")
    expect(result.ok).toBe(true)
    expect(result.counts.reportReady).toBe(1)
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
})
