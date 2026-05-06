import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { createOperationGoal } from "@/ulm/operation-goal"
import { operationPath, writeOperationPlan, writeRuntimeSummary } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { runRuntimeScheduler } from "@/ulm/runtime-scheduler"
import { tmpdir } from "../fixture/fixture"

async function writeBasicPlan(worktree: string, operationID = "School") {
  await writeOperationPlan(worktree, {
    operationID,
    phases: [
      {
        stage: "recon",
        objective: "Build a bounded inventory.",
        actions: ["Run passive discovery."],
        successCriteria: ["Inventory is recorded."],
        subagents: ["recon"],
        noSubagents: [],
      },
    ],
    reportingCloseout: ["report_lint before handoff", "report_render final package", "runtime_summary final accounting"],
  })
}

async function addSupervisorLane(worktree: string, operationID = "School", status: "ready" | "complete" = "ready") {
  const root = operationPath(worktree, operationID)
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
  graph.lanes.push({
    id: "supervisor",
    title: "Supervisor heartbeat",
    agent: "pentest",
    status,
    dependsOn: [],
    modelRoute: "openai/gpt-5.5-fast",
    fallbackModelRoutes: ["openai/gpt-5.4-mini-fast"],
    allowedTools: ["operation_supervise", "operation_resume", "operation_status"],
    expectedArtifacts: ["supervisor/latest.md"],
    budget: {},
    restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 30 },
    operationID: "school",
  })
  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
}

async function writeLongSupervisedOperation(worktree: string, operationID = "School") {
  await createOperationGoal(worktree, {
    operationID,
    objective: "Authorized overnight internal assessment.",
    targetDurationHours: 20,
  })
  await writeBasicPlan(worktree, operationID)
  await writeOperationGraph(worktree, { operationID, budgetUSD: 10 })
  await addSupervisorLane(worktree, operationID)
  await writeRuntimeSummary(worktree, {
    operationID,
    usage: { costUSD: 1, budgetUSD: 10 },
    compaction: { pressure: "low" },
  })
}

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
    expect(result.cycles[0]?.run?.action).toBe("launch_lane")
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

  test("runs supervisor heartbeats by default for long operations when the interval elapses", async () => {
    await using dir = await tmpdir({ git: true })
    await writeLongSupervisedOperation(dir.path)
    const launched: string[] = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 30,
      lastSupervisorReviewAt: new Date("2026-05-05T00:00:00.000Z"),
      now: new Date("2026-05-05T00:31:00.000Z"),
      launchModelLane: async (params) => {
        launched.push(params.laneID)
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.cycles[0]?.supervisor?.ran).toBe(true)
    expect(result.cycles[0]?.supervisor?.action).toBe("continue")
    expect(launched).toEqual(["recon"])
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.supervisorRan).toBe(true)
    expect(heartbeat.supervisorAction).toBe("continue")
  })

  test("supervisor blockers prevent new lane launch", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Authorized overnight internal assessment.",
      targetDurationHours: 20,
    })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const launched: string[] = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      launchModelLane: async (params) => {
        launched.push(params.laneID)
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.stopped).toBe(true)
    expect(result.reason).toBe("operation plan is missing")
    expect(result.cycles[0]?.run).toBeUndefined()
    expect(result.cycles[0]?.supervisor?.action).toBe("blocked")
    expect(result.cycles[0]?.supervisor?.requiredNextTool).toBe("operation_plan")
    expect(launched).toEqual([])
  })

  test("supervisor recover decisions hold launches and point at the recovery path", async () => {
    await using dir = await tmpdir({ git: true })
    await writeLongSupervisedOperation(dir.path)
    const root = operationPath(dir.path, "School")
    const graphPath = path.join(root, "plans", "operation-graph.json")
    const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
    graph.lanes[0].status = "failed"
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
    const launched: string[] = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      launchModelLane: async (params) => {
        launched.push(params.laneID)
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.stopped).toBe(false)
    expect(result.reason).toContain("failed")
    expect(result.cycles[0]?.supervisor?.action).toBe("recover")
    expect(result.cycles[0]?.supervisor?.nextTools).toContain("operation_resume")
    expect(result.cycles[0]?.run).toBeUndefined()
    expect(launched).toEqual([])
  })

  test("supervisor handoff-ready decisions allow the final run audit path", async () => {
    await using dir = await tmpdir({ git: true })
    const goal = await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Authorized overnight internal assessment.",
      targetDurationHours: 20,
    })
    await writeBasicPlan(dir.path)
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await addSupervisorLane(dir.path, "School", "complete")
    const root = operationPath(dir.path, "School")
    const graphPath = path.join(root, "plans", "operation-graph.json")
    const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete" }))
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
    await fs.writeFile(
      goal.files.json,
      JSON.stringify({ ...goal.goal, status: "complete", updatedAt: "2026-05-05T00:00:00.000Z", completedAt: "2026-05-05T00:00:00.000Z" }, null, 2) +
        "\n",
    )
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 9, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
    await fs.writeFile(path.join(root, "deliverables", "final", "manifest.json"), JSON.stringify({ operationID: "school" }, null, 2) + "\n")

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      supervisorReviewKind: "pre_handoff",
    })

    expect(result.cycles[0]?.supervisor?.action).toBe("handoff_ready")
    expect(result.cycles[0]?.run?.action).toBe("stop")
    expect(result.reason).toBe("all operation lanes are complete")
  })
})
