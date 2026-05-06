import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath } from "@/ulm/artifact"
import { runBurnInHarness } from "@/ulm/burnin-harness"
import { auditLiteralRunReadiness } from "@/ulm/literal-run-readiness"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { writeRuntimeSupervisor } from "@/ulm/runtime-supervisor"
import { tmpdir } from "../fixture/fixture"

describe("ULM literal run readiness audit", () => {
  test("separates accelerated burn-in from literal wall-clock proof", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Literal Operation"

    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await runBurnInHarness(dir.path, {
      operationID,
      targetElapsedSeconds: 20 * 60 * 60,
      tickSeconds: 60 * 60,
      reset: true,
    })
    await writeRuntimeSupervisor({
      operationID,
      worktree: dir.path,
      bunPath: "bun",
      scriptPath: path.join(__dirname, "..", "..", "script", "ulm-runtime-daemon.ts"),
      durationSeconds: 20 * 60 * 60,
      intervalSeconds: 60,
      schedulerCyclesPerTick: 1,
      supervisor: "all",
    })

    const ready = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(ready.status).toBe("incomplete")
    expect(ready.checks.find((item) => item.id === "accelerated-burnin-proof")?.status).toBe("ok")
    expect(ready.checks.find((item) => item.id === "literal-runtime-proof")?.status).toBe("fail")

    const root = operationPath(dir.path, operationID)
    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "literal-operation",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [
            {
              launchedJobs: ["job-recon"],
              launchedCommandJobs: ["cmd-http"],
              run: { completedLanes: ["recon"], syncedJobs: ["job-recon"], completedWorkUnits: ["work-http"] },
            },
          ],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")

    const passed = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(passed.status).toBe("passed")
    expect(passed.literalElapsedSeconds).toBe(20 * 60 * 60)
    expect(await fs.readFile(passed.markdownPath, "utf8")).toContain("status: passed")
  })

  test("does not accept idle daemon heartbeats as useful autonomy proof", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Idle Daemon"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeRuntimeSupervisor({
      operationID,
      worktree: dir.path,
      bunPath: "bun",
      scriptPath: path.join(__dirname, "..", "..", "script", "ulm-runtime-daemon.ts"),
      durationSeconds: 20 * 60 * 60,
      intervalSeconds: 60,
      schedulerCyclesPerTick: 1,
      supervisor: "all",
    })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "idle-daemon",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "literal-runtime-proof")?.status).toBe("ok")
    expect(result.checks.find((item) => item.id === "literal-work-proof")?.status).toBe("fail")
  })

  test("accepts tool-owned daemon proof without requiring service-manager setup", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Tool Owned Daemon"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "tool-owned-daemon",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("passed")
    expect(result.checks.find((item) => item.id === "service-supervisor")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "service-supervisor")?.required).toBe(false)
  })

  test("runs through the operator script and supports strict mode", async () => {
    await using dir = await tmpdir({ git: true })
    const script = path.join(__dirname, "..", "..", "script", "ulm-literal-run-readiness.ts")

    const proc = Bun.spawn(["bun", "run", script, "--worktree", dir.path, "--operation-id", "Missing", "--json", "--strict"], {
      cwd: dir.path,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(1)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.status).toBe("blocked")
    expect(parsed.auditPath).toContain("literal-run-readiness.json")
  })
})
