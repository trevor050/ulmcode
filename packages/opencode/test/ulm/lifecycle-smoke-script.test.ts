import { describe, expect, test } from "bun:test"
import path from "path"

const packageRoot = path.join(__dirname, "../..")

describe("ULM lifecycle smoke script", () => {
  test("runs the package smoke command end to end", async () => {
    const proc = Bun.spawn(["bun", "run", "test:ulm-smoke"], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    })

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(stderr).not.toContain("error:")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("ulm_lifecycle_smoke: ok")
    expect(stdout).toContain("final_lint: ok")
    expect(stdout).toContain("operation_audit: ok")
    expect(stdout).toContain("report.pdf")
    expect(stdout).toContain("runtime-summary.json")
    expect(stdout).toContain("operation-audit.json")
  })
})
