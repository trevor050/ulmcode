import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { writeRuntimeSummary } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { runOperationStep } from "@/ulm/operation-run"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation run controller", () => {
  test("advances the first ready lane without manual graph mutation", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await runOperationStep(dir.path, { operationID: "School" })

    expect(result.action).toBe("launch_lane")
    expect(result.laneID).toBe("district_profile")
    expect(result.taskParams?.background).toBe(true)
    expect(result.taskParams?.modelRoute).toBe("opencode-go/default")
    expect(result.commandProfiles).toEqual([])
    const graph = JSON.parse(await fs.readFile(result.graphPath, "utf8"))
    expect(graph.lanes.find((lane: { id: string }) => lane.id === "district_profile")?.status).toBe("running")
  })

  test("marks complete lanes and unlocks dependent lanes", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "evidence", "raw"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "commands"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "raw", "service-inventory.xml"), "<nmaprun />\n")
    await fs.writeFile(path.join(operationRoot, "commands", "service-inventory.log"), "complete\n")
    await fs.writeFile(path.join(operationRoot, "status.md"), "recon done\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "recon",
      summary: "Recon finished.",
      artifacts: ["evidence/raw/", "commands/", "status.md"],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "recon")?.status).toBe("complete")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "web_inventory")?.status).toBe("ready")
    expect(result.completedLanes).toContain("recon")
  })

  test("does not complete a lane when proof artifacts are missing", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "district_profile",
      summary: "District profile finished.",
      artifacts: ["profiles/district-profile.json", "profiles/district-profile.md"],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    expect(result.blockers).toContain("proof artifact is missing or empty: profiles/district-profile.json")
    expect(result.completedLanes).not.toContain("district_profile")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "district_profile")?.status).toBe("running")
  })

  test("auto-completes running lanes only when lane completion proof references real artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "profiles"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.md"), "# District Profile\n")
    await fs.mkdir(path.join(operationRoot, "lane-complete"), { recursive: true })
    await fs.writeFile(
      path.join(operationRoot, "lane-complete", "district_profile.json"),
      JSON.stringify(
        {
          operationID: "school",
          laneID: "district_profile",
          status: "complete",
          completedAt: new Date().toISOString(),
          summary: "District profile has concrete artifacts.",
          artifacts: ["profiles/district-profile.json", "profiles/district-profile.md"],
          evidenceRefs: [],
        },
        null,
        2,
      ),
    )

    const result = await runOperationStep(dir.path, { operationID: "School" })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    expect(result.completedLanes).toContain("district_profile")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "district_profile")?.status).toBe("complete")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "person_recon")?.status).toBe("running")
  })

  test("syncs completed background jobs back to lane state", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "evidence", "raw"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "commands"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "raw", "service-inventory.xml"), "<nmaprun />\n")
    await fs.writeFile(path.join(operationRoot, "commands", "service-inventory.log"), "complete\n")
    await fs.writeFile(path.join(operationRoot, "status.md"), "recon done\n")
    await fs.mkdir(path.join(operationRoot, "lane-complete"), { recursive: true })
    await fs.writeFile(
      path.join(operationRoot, "lane-complete", "recon.json"),
      JSON.stringify(
        {
          operationID: "school",
          laneID: "recon",
          status: "complete",
          completedAt: new Date().toISOString(),
          summary: "Recon completed in a background job.",
          artifacts: ["evidence/raw/", "commands/", "status.md"],
          evidenceRefs: [],
        },
        null,
        2,
      ),
    )
    await fs.writeFile(
      path.join(operationRoot, "work-queue.json"),
      JSON.stringify(
        {
          operationID: "school",
          generatedAt: new Date().toISOString(),
          units: [
            {
              id: "work-unit-recon",
              operationID: "school",
              laneID: "recon",
              profileID: "service-inventory",
              status: "running",
              variables: { target: "10.0.0.5" },
              outputPrefix: "evidence/raw/service-inventory-10-0-0-5",
              rationale: "test",
              safety: "non_destructive",
              attempts: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        null,
        2,
      ),
    )

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      backgroundJobs: [
        {
          id: "task_123",
          type: "task",
          title: "Recon",
          status: "completed",
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
          metadata: { operationID: "school", laneID: "recon", workUnitID: "work-unit-recon" },
        },
      ],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const recon = updated.lanes.find((lane: { id: string }) => lane.id === "recon")
    expect(result.syncedJobs).toContain("task_123")
    expect(result.completedLanes).toContain("recon")
    expect(result.completedWorkUnits).toContain("work-unit-recon")
    expect(recon?.status).toBe("complete")
    expect(recon?.activeJobs[0]?.status).toBe("completed")
    const queue = JSON.parse(await fs.readFile(path.join(operationRoot, "work-queue.json"), "utf8"))
    expect(queue.units[0]?.status).toBe("complete")
  })

  test("syncs a recovered running job back from failed to running", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    await runOperationStep(dir.path, { operationID: "School", mode: "fail_lane", laneID: "recon" })

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      backgroundJobs: [
        {
          id: "task_recovered",
          type: "task",
          title: "Recon",
          status: "running",
          startedAt: Date.now(),
          metadata: { operationID: "school", laneID: "recon" },
        },
      ],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const recon = updated.lanes.find((lane: { id: string }) => lane.id === "recon")
    expect(result.syncedJobs).toContain("task_recovered")
    expect(recon?.status).toBe("running")
  })
})
