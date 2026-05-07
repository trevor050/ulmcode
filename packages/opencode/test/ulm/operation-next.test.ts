import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { decideOperationNext } from "@/ulm/operation-next"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { writeRuntimeSummary } from "@/ulm/artifact"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation next action", () => {
  test("asks for scheduling when no operation graph exists", async () => {
    await using dir = await tmpdir({ git: true })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("schedule")
    expect(result.action.recommendedTools).toContain("operation_schedule")
    expect(await fs.stat(result.path)).toBeTruthy()
  })

  test("launches the first ready lane when runtime is healthy", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("launch_lane")
    if (result.action.action !== "launch_lane") throw new Error("expected launch_lane")
    expect(result.action.lane.id).toBe("district_profile")
    expect(result.action.prompt).toContain('Run operation lane "district_profile"')
    expect(result.action.recommendedTools).toContain("district_profile")
  })

  test("waits when max concurrent lanes are already running", async () => {
    await using dir = await tmpdir({ git: true })
    const written = await writeOperationGraph(dir.path, { operationID: "School", maxConcurrentLanes: 1, budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes[0].status = "running"
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("wait")
    expect(result.action.reason).toContain("max concurrent lanes")
  })

  test("persists stop action after all lanes complete", async () => {
    await using dir = await tmpdir({ git: true })
    const written = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete" }))
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("stop")
    expect(result.action.reason).toContain("all operation lanes are complete")
    const persisted = JSON.parse(await fs.readFile(path.join(path.dirname(result.path), "next-action.json"), "utf8"))
    expect(persisted.action).toBe("stop")
  })
})
