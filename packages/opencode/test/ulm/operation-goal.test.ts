import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { completeOperationGoal, createOperationGoal, readOperationGoal } from "@/ulm/operation-goal"
import { tmpdir } from "../fixture/fixture"

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

describe("ULM operation goal", () => {
  test("creates durable goal json and markdown artifacts", async () => {
    await using dir = await tmpdir({ git: true })

    const result = await createOperationGoal(
      dir.path,
      {
        operationID: "School Night Run",
        objective: "Authorized overnight district network assessment",
        targetDurationHours: 20.125,
      },
      { now: "2026-05-06T00:00:00.000Z" },
    )

    expect(result.operationID).toBe("school-night-run")
    expect(result.created).toBe(true)
    expect(result.goal.targetDurationHours).toBe(20.13)
    expect(result.goal.completionPolicy.requiresOperationAudit).toBe(true)
    expect(result.goal.continuation.maxNoToolContinuationTurns).toBe(1)
    expect(result.goal.continuation.turnEndReview).toBe(true)
    expect(result.goal.continuation.injectPlanMaxChars).toBe(12000)
    expect(result.goal.continuation.operatorFallbackTimeoutSeconds).toBe(75)
    expect(result.goal.continuation.operatorFallbackEnabled).toBe(true)
    expect(result.goal.continuation.maxRepeatedOperatorTimeoutsPerKind).toBe(2)
    expect(await fs.readFile(result.files.markdown, "utf8")).toContain("Authorized overnight district network assessment")

    const read = await readOperationGoal(dir.path, "School Night Run")
    expect(read.goal?.operationID).toBe("school-night-run")
    expect(read.goal?.status).toBe("active")
  })

  test("generates a readable unique operation id when create omits one", async () => {
    await using dir = await tmpdir({ git: true })

    const first = await createOperationGoal(
      dir.path,
      { objective: "Authorized overnight district network assessment" },
      { now: "2026-05-06T00:00:00.000Z" },
    )
    const second = await createOperationGoal(
      dir.path,
      { objective: "Authorized follow-up district network assessment" },
      { now: "2026-05-06T00:01:00.000Z" },
    )

    expect(first.operationID).toMatch(/^[a-z]+-[a-z]+(-[a-z]+)?-[a-f0-9]{6}$/)
    expect(second.operationID).toMatch(/^[a-z]+-[a-z]+(-[a-z]+)?-[a-f0-9]{6}$/)
    expect(second.operationID).not.toBe(first.operationID)
    expect(first.goal.operationID).toBe(first.operationID)
    expect(await fs.readFile(first.files.json, "utf8")).toContain(`"operationID": "${first.operationID}"`)
  })

  test("does not overwrite an active goal through create", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(
      dir.path,
      { operationID: "school", objective: "First objective", targetDurationHours: 12 },
      { now: "2026-05-06T00:00:00.000Z" },
    )

    const result = await createOperationGoal(
      dir.path,
      { operationID: "school", objective: "Second objective", targetDurationHours: 36 },
      { now: "2026-05-06T01:00:00.000Z" },
    )

    expect(result.created).toBe(false)
    expect(result.goal.objective).toBe("First objective")
    expect(result.goal.targetDurationHours).toBe(12)
  })

  test("records blockers instead of completing without required artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Finish full report", targetDurationHours: 20 })

    const result = await completeOperationGoal(dir.path, { operationID: "school" }, { now: "2026-05-06T02:00:00.000Z" })

    expect(result.completed).toBe(false)
    expect(result.blockers).toContain("deliverables/runtime-summary.json is missing or invalid")
    expect(result.blockers).toContain("deliverables/final/manifest.json is missing or invalid")
    expect(result.blockers).toContain("deliverables/operation-audit.json is missing or invalid")
    expect(result.blockers).toContain("deliverables/stage-gates/handoff.json is missing or invalid")
    expect(await fs.readFile(result.files.blockers, "utf8")).toContain("deliverables/runtime-summary.json is missing or invalid")
  })

  test("marks goal complete when completion artifacts exist", async () => {
    await using dir = await tmpdir({ git: true })
    const created = await createOperationGoal(dir.path, { operationID: "school", objective: "Finish full report", targetDurationHours: 20 })
    const root = path.join(dir.path, ".ulmcode", "operations", "school")
    await writeJson(path.join(root, "deliverables", "runtime-summary.json"), { operationID: "school" })
    await writeJson(path.join(root, "deliverables", "final", "manifest.json"), { operationID: "school" })
    await writeJson(path.join(root, "deliverables", "operation-audit.json"), { operationID: "school", ok: true })
    await writeJson(path.join(root, "deliverables", "stage-gates", "handoff.json"), { operationID: "school", ok: true })

    const result = await completeOperationGoal(dir.path, { operationID: "school" }, { now: "2026-05-06T03:00:00.000Z" })

    expect(result.completed).toBe(true)
    expect(result.goal?.status).toBe("complete")
    expect(result.goal?.completedAt).toBe("2026-05-06T03:00:00.000Z")
    expect(await fs.readFile(created.files.json, "utf8")).toContain('"status": "complete"')
  })

  test("rejects empty objectives and negative durations", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(createOperationGoal(dir.path, { operationID: "school", objective: " " })).rejects.toThrow("objective is required")
    await expect(
      createOperationGoal(dir.path, { operationID: "school", objective: "Authorized run", targetDurationHours: -1 }),
    ).rejects.toThrow("targetDurationHours must be a non-negative number")
  })
})
