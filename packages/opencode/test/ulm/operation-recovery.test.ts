import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { writeRuntimeSummary } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { markRecoveredLanesRunning, restartableOperationJobs } from "@/ulm/operation-recovery"
import { runOperationStep } from "@/ulm/operation-run"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation recovery graph sync", () => {
  test("marks recovered failed lanes running and appends a recovery log record", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    await runOperationStep(dir.path, { operationID: "School", mode: "fail_lane", laneID: "recon" })

    const recovered = await markRecoveredLanesRunning(dir.path, {
      operationID: "School",
      jobs: [
        {
          id: "task_recovered",
          type: "task",
          title: "Recon",
          status: "stale",
          startedAt: Date.now(),
          metadata: { operationID: "school", laneID: "recon" },
        },
      ],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const recon = updated.lanes.find((lane: { id: string }) => lane.id === "recon")
    expect(recovered).toEqual(["recon"])
    expect(recon?.status).toBe("running")
    expect(recon?.activeJobs[0]?.id).toBe("task_recovered")
    expect(await fs.readFile(graph.json.replace("operation-graph.json", "operation-run.jsonl"), "utf8")).toContain(
      '"mode":"recover_lane"',
    )
  })

  test("selects only restartable stale operation jobs for daemon-owned recovery", () => {
    const restartable = restartableOperationJobs({
      operationID: "School",
      jobs: [
        {
          id: "task-stale",
          type: "task",
          title: "Recon",
          status: "stale",
          startedAt: Date.now(),
          metadata: { operationID: "school", prompt: "resume", subagent_type: "recon" },
        },
        {
          id: "command-stale",
          type: "command_supervise",
          title: "HTTP",
          status: "error",
          startedAt: Date.now(),
          metadata: { operationID: "school", profileID: "http-discovery" },
        },
        {
          id: "missing-metadata",
          type: "task",
          title: "Broken",
          status: "stale",
          startedAt: Date.now(),
          metadata: { operationID: "school" },
        },
        {
          id: "other-operation",
          type: "task",
          title: "Other",
          status: "stale",
          startedAt: Date.now(),
          metadata: { operationID: "other", prompt: "resume", subagent_type: "recon" },
        },
      ],
    })

    expect(restartable.map((job) => job.id)).toEqual(["task-stale", "command-stale"])
  })
})
