import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { createOperationGoal } from "@/ulm/operation-goal"
import { operationPath, writeOperationPlan, writeRuntimeSummary } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { runRuntimeDaemon } from "@/ulm/runtime-daemon"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.join(__dirname, "../..")

function fakeClock(start: string, stepSeconds: number) {
  let tick = 0
  return () => new Date(Date.parse(start) + tick++ * stepSeconds * 1000)
}

async function writeDaemonSupervisorFixture(worktree: string) {
  await createOperationGoal(worktree, {
    operationID: "School",
    objective: "Authorized overnight internal assessment.",
    targetDurationHours: 20,
  })
  await writeOperationPlan(worktree, {
    operationID: "School",
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
  await writeOperationGraph(worktree, { operationID: "School", budgetUSD: 10 })
  const root = operationPath(worktree, "School")
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
  graph.lanes.push({
    id: "supervisor",
    title: "Supervisor heartbeat",
    agent: "pentest",
    status: "complete",
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
  await writeRuntimeSummary(worktree, {
    operationID: "School",
    usage: { costUSD: 1, budgetUSD: 10 },
    compaction: { pressure: "low" },
  })
}

describe("ULM runtime daemon", () => {
  test("owns a wall-clock scheduler loop with heartbeats and a released lock", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const sleeps: number[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 5,
      maxCycles: 2,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
    })

    expect(result.cycles.length).toBeGreaterThanOrEqual(1)
    expect(sleeps).toEqual([5000])
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.operationID).toBe("school")
    await expect(fs.access(result.lockPath)).rejects.toThrow()
    expect(await fs.readFile(result.logPath, "utf8")).toContain('"operationID":"school"')
  })

  test("passes scheduler launch hooks through daemon ticks", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const launched: string[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
      launchModelLane: async (params) => {
        launched.push(params.laneID)
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(launched).toEqual(["district_profile"])
    expect(result.cycles[0]?.launchedJobs).toEqual(["job-district_profile"])
  })

  test("recovers stale operation jobs before scheduler ticks", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const recovered: string[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
      backgroundJobs: [
        {
          id: "task_stale_recon",
          type: "task",
          title: "Recon",
          status: "stale",
          startedAt: Date.now(),
          metadata: {
            operationID: "school",
            laneID: "recon",
            prompt: "resume recon",
            subagent_type: "recon",
          },
        },
      ],
      recoverBackgroundJob: async (job) => {
        recovered.push(job.id)
        return { jobID: `${job.id}_recovered` }
      },
    })

    expect(recovered).toEqual(["task_stale_recon"])
    expect(result.recoveredJobs).toEqual(["task_stale_recon_recovered"])
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.recoveredJobs).toEqual(["task_stale_recon_recovered"])
  })

  test("passes command work-unit launch hooks through daemon ticks", async () => {
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
    const launched: string[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
      launchCommandWorkUnit: async (params) => {
        launched.push(params.workUnitID)
        return { jobID: `cmd-${params.workUnitID}` }
      },
    })

    expect(launched).toEqual(["work-unit-http"])
    expect(result.cycles[0]?.launchedCommandJobs).toEqual(["cmd-work-unit-http"])
  })

  test("passes supervisor cadence through daemon ticks", async () => {
    await using dir = await tmpdir({ git: true })
    await writeDaemonSupervisorFixture(dir.path)

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 3600,
      cycleIntervalSeconds: 0,
      maxCycles: 2,
      supervisorIntervalMinutes: 30,
      now: fakeClock("2026-05-05T00:00:00.000Z", 600),
      sleep: async () => {},
    })

    expect(result.cycles).toHaveLength(2)
    expect(result.cycles[0]?.supervisor?.ran).toBe(true)
    expect(result.cycles[1]?.supervisor?.ran).toBe(false)
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.cycles[0].supervisor.ran).toBe(true)
    expect(heartbeat.cycles[1].supervisor.ran).toBe(false)
  })

  test("refuses an active daemon lock and replaces a stale lock", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    const lockPath = path.join(root, "scheduler", "daemon.lock.json")
    await fs.mkdir(path.dirname(lockPath), { recursive: true })
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, createdAt: "2026-05-05T00:00:00.000Z", updatedAt: "2026-05-05T00:00:00.000Z" }),
    )

    await expect(
      runRuntimeDaemon(dir.path, {
        operationID: "School",
        maxCycles: 1,
        now: () => new Date("2026-05-05T00:00:10.000Z"),
        sleep: async () => {},
      }),
    ).rejects.toThrow("runtime daemon lock is active")

    const recovered = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxCycles: 1,
      staleLockSeconds: 1,
      now: fakeClock("2026-05-05T00:10:00.000Z", 1),
      sleep: async () => {},
    })

    expect(recovered.operationID).toBe("school")
    await expect(fs.access(lockPath)).rejects.toThrow()
  })

  test("runs through the operator CLI wrapper", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
        "School",
        "--duration-seconds",
        "5",
        "--interval-seconds",
        "0",
        "--max-cycles",
        "1",
        "--json",
      ],
      { cwd: dir.path, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.operationID).toBe("school")
    expect(parsed.heartbeatPath).toContain("daemon-heartbeat.json")
  })

  test("detaches the operator CLI wrapper for long wall-clock runs", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
        "School",
        "--duration-seconds",
        "5",
        "--interval-seconds",
        "0",
        "--max-cycles",
        "1",
        "--detach",
        "--json",
      ],
      { cwd: dir.path, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.operationID).toBe("school")
    expect(parsed.pid).toBeGreaterThan(0)
    expect(await fs.readFile(parsed.launchPath, "utf8")).toContain('"operationID": "school"')
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const heartbeat = JSON.parse(await fs.readFile(parsed.heartbeatPath, "utf8"))
        expect(heartbeat.operationID).toBe("school")
        return
      } catch {
        await Bun.sleep(50)
      }
    }
    throw new Error("detached daemon did not write heartbeat")
  })

  test("writes launchd and systemd supervisor artifacts without daemonizing under the supervisor", async () => {
    await using dir = await tmpdir({ git: true })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
        "School",
        "--duration-hours",
        "20",
        "--interval-seconds",
        "60",
        "--supervisor",
        "all",
        "--json",
      ],
      { cwd: dir.path, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.operationID).toBe("school")
    expect(parsed.files.launchdPlist).toContain("com.ulmcode.runtime-daemon.school.plist")
    expect(parsed.files.systemdService).toContain("ulmcode-runtime-daemon-school.service")
    expect(parsed.files.runbook).toContain("supervisor-install.md")
    expect(parsed.files.manifest).toContain("supervisor-manifest.json")

    const launchd = await fs.readFile(parsed.files.launchdPlist, "utf8")
    expect(launchd).toContain("<key>ProgramArguments</key>")
    expect(launchd).toContain("ulm-runtime-daemon.ts")
    expect(launchd).toContain("<key>WorkingDirectory</key>")
    expect(launchd).toContain("<key>StandardOutPath</key>")
    expect(launchd).toContain("<key>KeepAlive</key>")
    expect(launchd).not.toContain("--detach")

    const systemd = await fs.readFile(parsed.files.systemdService, "utf8")
    expect(systemd).toContain("[Service]")
    expect(systemd).toContain(`WorkingDirectory=${dir.path}`)
    expect(systemd).toContain("Restart=on-failure")
    expect(systemd).toContain("ulm-runtime-daemon.ts")
    expect(systemd).not.toContain("--detach")

    const runbook = await fs.readFile(parsed.files.runbook, "utf8")
    expect(runbook).toContain("launchctl bootstrap")
    expect(runbook).toContain("systemctl --user enable --now")
  })

  test("records scheduler errors, backs off, and stops after the error budget", async () => {
    await using dir = await tmpdir({ git: true })
    const sleeps: number[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "MissingGraph",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 0,
      errorBackoffSeconds: 7,
      maxConsecutiveErrors: 2,
      maxCycles: 3,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
    })

    expect(result.stopped).toBe(true)
    expect(result.reason).toContain("scheduler error")
    expect(sleeps).toEqual([7000])
    const log = await fs.readFile(result.logPath, "utf8")
    expect(log).toContain('"consecutiveErrors":1')
    expect(log).toContain('"consecutiveErrors":2')
  })
})
