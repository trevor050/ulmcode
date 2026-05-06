import { describe, expect, test } from "bun:test"
import { writeOperationPlan, writeRuntimeSummary } from "@/ulm/artifact"
import { createOperationGoal } from "@/ulm/operation-goal"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { superviseOperation } from "@/ulm/operation-supervisor"
import { tmpdir } from "../fixture/fixture"

async function writeMinimalPlan(root: string) {
  await writeOperationPlan(root, {
    operationID: "school",
    phases: [
      {
        stage: "recon",
        objective: "Inventory authorized targets.",
        actions: ["Run supervised inventory"],
        successCriteria: ["Raw inventory evidence exists"],
        subagents: ["recon"],
        noSubagents: ["Final reporting"],
      },
    ],
    reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary", "Run operation_audit"],
  })
}

describe("ULM operation supervisor", () => {
  test("requires an operation goal before broad execution", async () => {
    await using dir = await tmpdir({ git: true })

    const review = await superviseOperation(dir.path, { operationID: "school", writeArtifacts: false })

    expect(review.decisions[0]?.action).toBe("blocked")
    expect(review.decisions[0]?.requiredNextTool).toBe("operation_goal")
    expect(review.decisions.map((item) => item.requiredNextTool)).toContain("operation_plan")
  })

  test("requires an operation plan after goal creation", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized overnight assessment", targetDurationHours: 20 })

    const review = await superviseOperation(dir.path, { operationID: "school", writeArtifacts: false })

    expect(review.decisions[0]?.requiredNextTool).toBe("operation_plan")
  })

  test("blocks long-run graphs that omit a supervisor lane", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized overnight assessment", targetDurationHours: 20 })
    await writeMinimalPlan(dir.path)
    await writeOperationGraph(dir.path, { operationID: "school" })

    const review = await superviseOperation(dir.path, { operationID: "school", writeArtifacts: false })

    expect(review.decisions.map((item) => item.reason)).toContain("long-run graph has no supervisor lane")
    expect(review.decisions.find((item) => item.reason === "long-run graph has no supervisor lane")?.requiredNextTool).toBe(
      "operation_schedule",
    )
  })

  test("blocks final handoff when runtime blind spots are recorded", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized overnight assessment", targetDurationHours: 20 })
    await writeMinimalPlan(dir.path)
    await writeRuntimeSummary(dir.path, {
      operationID: "school",
      notes: ["runtime blind spot: background task task-recon has no readable session ledger"],
    })

    const review = await superviseOperation(dir.path, { operationID: "school", reviewKind: "pre_handoff", writeArtifacts: true })

    expect(review.decisions.map((item) => item.reason)).toContain("runtime summary records a blind spot")
    expect(review.files?.json).toContain("supervisor-review-")
    expect(review.files?.markdown).toContain("latest.md")
  })
})
