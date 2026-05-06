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
    expect(JSON.parse(formatOperationStatusOutput(item, "json")).operationID).toBe("school")
  })
})
