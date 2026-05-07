import { describe, expect, test } from "bun:test"
import { formatOperationListTable, formatOperationStatusOutput } from "@/cli/cmd/ulm"
import type { OperationStatusSummary } from "@/ulm/artifact"

function status(input: Partial<OperationStatusSummary> = {}): OperationStatusSummary {
  return {
    operationID: "school",
    root: "/tmp/.ulmcode/operations/school",
    operation: {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
      nextActions: ["Promote confirmed findings"],
      blockers: [],
      riskLevel: "high",
      activeTasks: ["task-1"],
      evidence: [],
      time: {
        created: "2026-05-05T10:00:00.000Z",
        updated: "2026-05-05T10:05:00.000Z",
      },
    },
    goal: {
      status: "active",
      objective: "Authorized school assessment",
      targetDurationHours: 20,
      updatedAt: "2026-05-05T10:05:00.000Z",
    },
    supervisor: {
      generatedAt: "2026-05-05T10:06:00.000Z",
      action: "blocked",
      reason: "operation plan is missing",
      requiredNextTool: "operation_plan",
      blockers: ["operation plan is missing"],
      nextTools: ["operation_plan"],
    },
    toolInventory: {
      generatedAt: "2026-05-05T10:07:00.000Z",
      total: 20,
      installed: 12,
      missing: 8,
      highValueMissing: 2,
      installedHighValue: ["nmap", "httpx"],
      missingHighValue: ["nuclei", "ffuf"],
    },
    policies: {
      foregroundCommand:
        "Commands expected to exceed two minutes must run through command_supervise, task background=true, runtime_scheduler, or runtime_daemon.",
    },
    plans: { operation: true },
    findings: {
      total: 2,
      byState: { candidate: 0, needs_validation: 0, validated: 1, report_ready: 1, rejected: 0 },
      bySeverity: { info: 0, low: 0, medium: 0, high: 2, critical: 0 },
    },
    evidence: {
      total: 4,
      byKind: { command_output: 1, http_response: 1, screenshot: 0, file: 2, note: 0, log: 0 },
    },
    reports: {
      outline: true,
      markdown: true,
      html: true,
      pdf: false,
      readme: false,
      manifest: true,
    },
    runtimeSummary: true,
    lastEvents: [],
    ...input,
  }
}

describe("ulm cli formatting", () => {
  test("formats operation list as a compact table", () => {
    const output = formatOperationListTable([status(), status({ operationID: "district" })])
    expect(output).toContain("Operation")
    expect(output).toContain("school")
    expect(output).toContain("district")
    expect(output).toContain("html,manifest,runtime")
  })

  test("formats status as dashboard or json", () => {
    const item = status()
    expect(formatOperationStatusOutput(item, "dashboard")).toContain("# school - validation/running")
    expect(formatOperationStatusOutput(item, "dashboard")).toContain("goal: active, 20h")
    expect(formatOperationStatusOutput(item, "dashboard")).toContain("supervisor: blocked - operation plan is missing")
    expect(formatOperationStatusOutput(item, "dashboard")).toContain("tools: 12/20 installed, 2 high-value missing")
    expect(JSON.parse(formatOperationStatusOutput(item, "json")).operationID).toBe("school")
  })
})
