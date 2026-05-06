import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath, writeRuntimeSummary } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { runRuntimeScheduler } from "@/ulm/runtime-scheduler"
import { tmpdir } from "../fixture/fixture"

describe("ULM runtime scheduler", () => {
  test("writes heartbeat and advances operation lanes without chat-memory coordination", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await runRuntimeScheduler(dir.path, { operationID: "School", maxCycles: 1 })

    expect(result.cycles).toHaveLength(1)
    expect(result.cycles[0]?.run.action).toBe("launch_lane")
    expect(result.cycles[0]?.governor.action).toBe("continue")
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.lastAction).toBe("launch_lane")
    expect(await fs.readFile(result.logPath, "utf8")).toContain('"cycle":1')
  })

  test("launches prepared model lanes through the scheduler owner hook", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const launched: Array<{ laneID: string; modelRoute: string }> = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      launchModelLane: async (params) => {
        launched.push({ laneID: params.laneID, modelRoute: params.modelRoute })
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(launched).toEqual([{ laneID: "recon", modelRoute: "opencode-go/default" }])
    expect(result.cycles[0]?.launchedJobs).toEqual(["job-recon"])
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.launchedJobs).toEqual(["job-recon"])
  })

  test("requeues stale claimed work units during scheduler cycles", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "work-queue.json"),
      JSON.stringify(
        {
          operationID: "school",
          generatedAt: "2026-05-05T00:00:00.000Z",
          units: [
            {
              id: "work-unit-web",
              operationID: "school",
              laneID: "web_inventory",
              profileID: "http-discovery",
              status: "running",
              variables: { inputFile: "queues/hosts.txt" },
              outputPrefix: "evidence/raw/http-discovery",
              rationale: "test",
              safety: "non_destructive",
              attempts: 1,
              createdAt: "2026-05-05T00:00:00.000Z",
              updatedAt: "2026-05-05T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    )

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      leaseSeconds: 60,
      now: new Date("2026-05-05T00:10:00.000Z"),
    })

    expect(result.cycles[0]?.requeuedWorkUnits).toEqual(["work-unit-web"])
    const queue = JSON.parse(await fs.readFile(path.join(root, "work-queue.json"), "utf8"))
    expect(queue.units[0]?.status).toBe("queued")
  })

  test("claims queued command units and launches them through the scheduler owner hook", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "work-queue.json"),
      JSON.stringify(
        {
          operationID: "school",
          generatedAt: "2026-05-05T00:00:00.000Z",
          units: [
            {
              id: "work-unit-http",
              operationID: "school",
              laneID: "web_inventory",
              profileID: "http-discovery",
              status: "queued",
              variables: { inputFile: "queues/hosts.txt" },
              outputPrefix: "evidence/raw/http-discovery",
              rationale: "test",
              safety: "non_destructive",
              attempts: 0,
              createdAt: "2026-05-05T00:00:00.000Z",
              updatedAt: "2026-05-05T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    )
    const launched: Array<{ workUnitID: string; dryRun: boolean }> = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      launchCommandWorkUnit: async (params) => {
        launched.push({ workUnitID: params.workUnitID, dryRun: params.dryRun })
        return { jobID: `cmd-${params.workUnitID}` }
      },
    })

    expect(launched).toEqual([{ workUnitID: "work-unit-http", dryRun: false }])
    expect(result.cycles[0]?.launchedCommandJobs).toEqual(["cmd-work-unit-http"])
    const queue = JSON.parse(await fs.readFile(path.join(root, "work-queue.json"), "utf8"))
    expect(queue.units[0]?.status).toBe("running")
    expect(queue.units[0]?.attempts).toBe(1)
  })
})
