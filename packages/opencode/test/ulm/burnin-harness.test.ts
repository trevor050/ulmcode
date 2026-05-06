import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { runBurnInHarness } from "@/ulm/burnin-harness"
import { tmpdir } from "../fixture/fixture"

describe("ULM accelerated burn-in harness", () => {
  test("resumes from a checkpoint and writes a complete proof artifact", async () => {
    await using dir = await tmpdir({ git: true })

    const interrupted = await runBurnInHarness(dir.path, {
      operationID: "Long Autonomy",
      targetElapsedSeconds: 20 * 60 * 60,
      tickSeconds: 15 * 60,
      maxTicks: 3,
      reset: true,
    })

    expect(interrupted.audit.status).toBe("incomplete")
    expect(interrupted.proof.elapsedTargetSeconds).toBe(20 * 60 * 60)
    expect(interrupted.proof.ticks).toBe(3)
    expect(interrupted.proof.supervisorScenario.operationGoalCreated).toBe(true)
    expect(interrupted.proof.supervisorScenario.targetDurationHours).toBe(20)
    expect(interrupted.proof.supervisorScenario.planPlanWritten).toBe(true)
    expect(interrupted.proof.supervisorScenario.supervisorLanePresent).toBe(true)
    expect(interrupted.proof.supervisorScenario.staleCommandLaneSimulated).toBe(true)
    expect(interrupted.proof.supervisorScenario.staleCommandLaneRecovered).toBe(false)
    expect(interrupted.proof.supervisorScenario.toolInventoryWritten).toBe(true)
    expect(interrupted.proof.supervisorScenario.runtimeSummaryWritten).toBe(true)
    expect(interrupted.proof.supervisorScenario.completionBlockedBeforeAudit).toBe(true)
    expect(interrupted.proof.supervisorScenario.finalAuditWritten).toBe(false)
    expect(interrupted.proof.supervisorScenario.goalCompletedAfterAudit).toBe(false)

    const resumed = await runBurnInHarness(dir.path, {
      operationID: "Long Autonomy",
      targetElapsedSeconds: 20 * 60 * 60,
      tickSeconds: 15 * 60,
    })

    expect(resumed.audit.status).toBe("passed")
    expect(resumed.proof.elapsedTargetSeconds).toBe(20 * 60 * 60)
    expect(resumed.proof.simulatedElapsedSeconds).toBe(20 * 60 * 60)
    expect(resumed.proof.ticks).toBe(80)
    expect(resumed.proof.daemonHeartbeats).toBe(80)
    expect(resumed.proof.schedulerHeartbeats).toBe(80)
    expect(resumed.proof.restartCount).toBe(1)
    expect(resumed.proof.auditStatus).toBe("passed")
    expect(resumed.proof.resumedFromCheckpoint).toBe(true)
    expect(resumed.proof.supervisorScenario.supervisorReviews).toBe(2)
    expect(resumed.proof.supervisorScenario.staleCommandLaneRecovered).toBe(true)
    expect(resumed.proof.supervisorScenario.completionBlockedBeforeAudit).toBe(true)
    expect(resumed.proof.supervisorScenario.finalAuditWritten).toBe(true)
    expect(resumed.proof.supervisorScenario.goalCompletedAfterAudit).toBe(true)

    const proofOnDisk = JSON.parse(await fs.readFile(resumed.proofPath, "utf8"))
    expect(proofOnDisk.auditStatus).toBe("passed")
    expect(proofOnDisk.supervisorScenario.goalCompletedAfterAudit).toBe(true)
    expect(proofOnDisk.heartbeatPaths.daemon).toBe(resumed.daemonHeartbeatPath)
    expect(proofOnDisk.heartbeatPaths.scheduler).toBe(resumed.schedulerHeartbeatPath)
    const scenarioOnDisk = JSON.parse(await fs.readFile(resumed.proof.supervisorScenario.proofPath, "utf8"))
    expect(scenarioOnDisk.supervisorLanePresent).toBe(true)
    expect(scenarioOnDisk.completionBlockedBeforeAudit).toBe(true)

    const checkpoint = JSON.parse(await fs.readFile(resumed.checkpointPath, "utf8"))
    expect(checkpoint.completed).toBe(true)
    expect(checkpoint.ticks).toBe(80)
    expect(await fs.readFile(path.join(path.dirname(resumed.proofPath), "burnin-audit.md"), "utf8")).toContain(
      "audit_status: passed",
    )
    expect(await fs.readFile(path.join(path.dirname(resumed.proofPath), "burnin-audit.md"), "utf8")).toContain(
      "goal_completed_after_audit: true",
    )
  })

  test("runs through the burn-in script wrapper", async () => {
    await using dir = await tmpdir({ git: true })
    const script = path.join(__dirname, "..", "..", "script", "ulm-burnin.ts")

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        script,
        "Script Operation",
        "--target-seconds",
        "120",
        "--tick-seconds",
        "30",
        "--json",
        "--reset",
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
    expect(parsed.proof.auditStatus).toBe("passed")
    expect(parsed.proof.ticks).toBe(4)
    expect(parsed.proof.supervisorScenario.completionBlockedBeforeAudit).toBe(true)
    expect(parsed.proof.supervisorScenario.goalCompletedAfterAudit).toBe(true)
    expect(await fs.readFile(parsed.proofPath, "utf8")).toContain('"elapsedTargetSeconds": 120')
  })
})
