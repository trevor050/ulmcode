import { describe, expect, test } from "bun:test"
import { BaselineCheckTool } from "../../src/tool/baseline_check"
import { ComplianceMapperTool } from "../../src/tool/compliance_mapper"
import { AlertAnalyzerTool } from "../../src/tool/alert_analyzer"
import { DetectionValidatorTool } from "../../src/tool/detection_validator"
import { IRTimelineBuilderTool } from "../../src/tool/ir_timeline_builder"

const ctx = {
  sessionID: "session_test",
  messageID: "",
  callID: "",
  agent: "action",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("defensive tools", () => {
  test("baseline_check returns drift findings", async () => {
    const tool = await BaselineCheckTool.init()
    const result = await tool.execute(
      {
        target: "dc01",
        framework: "CIS",
        observations: [
          {
            control_id: "5.2.1",
            current_state: "PermitRootLogin yes",
            expected_state: "PermitRootLogin no",
            severity: "high",
          },
        ],
      },
      ctx,
    )

    expect(result.metadata.gap_count).toBe(1)
    expect(result.metadata.suggested_findings[0].finding_type).toBe("hardening_recommendation")
  })

  test("compliance_mapper computes coverage and unmapped findings", async () => {
    const tool = await ComplianceMapperTool.init()
    const result = await tool.execute(
      {
        framework: "FERPA",
        findings: [
          {
            id: "FND-1",
            title: "Access logging gap",
            severity: "high",
            control_refs: [{ framework: "FERPA", control_id: "A-1" }],
          },
          {
            id: "FND-2",
            title: "No mapping yet",
            severity: "low",
          },
        ],
      },
      ctx,
    )

    expect(result.metadata.mapped_findings).toBe(1)
    expect(result.metadata.unmapped_findings.length).toBe(1)
  })

  test("alert_analyzer summarizes false positive rate", async () => {
    const tool = await AlertAnalyzerTool.init()
    const result = await tool.execute(
      {
        alerts: [
          { id: "A1", title: "Suspicious login", source: "SIEM", severity: "high", status: "false_positive" },
          { id: "A2", title: "PowerShell execution", source: "EDR", severity: "medium", status: "new" },
        ],
      },
      ctx,
    )

    expect(result.metadata.alerts_analyzed).toBe(2)
    expect(result.metadata.false_positive_rate).toBe(0.5)
  })

  test("detection_validator computes coverage ratio", async () => {
    const tool = await DetectionValidatorTool.init()
    const result = await tool.execute(
      {
        techniques: [
          { id: "T1059", name: "Command and Scripting Interpreter" },
          { id: "T1110", name: "Brute Force" },
        ],
        detection_rules: [
          { id: "R1", name: "Detect PowerShell", techniques: ["T1059"], enabled: true },
        ],
      },
      ctx,
    )

    expect(result.metadata.covered_techniques).toBe(1)
    expect(result.metadata.uncovered_techniques.length).toBe(1)
  })

  test("ir_timeline_builder sorts events", async () => {
    const tool = await IRTimelineBuilderTool.init()
    const result = await tool.execute(
      {
        incident_id: "INC-001",
        events: [
          { timestamp: "2026-02-10T03:00:00Z", category: "containment", summary: "Host isolated" },
          { timestamp: "2026-02-10T01:00:00Z", category: "detection", summary: "Alert fired" },
        ],
      },
      ctx,
    )

    expect(result.metadata.timeline[0].category).toBe("detection")
    expect(result.metadata.event_count).toBe(2)
  })
})
