import { describe, expect, test } from "bun:test"
import path from "path"

const packageRoot = path.join(__dirname, "../..")

describe("ULM lab replay script", () => {
  test("runs the bundled lab replay command", async () => {
    const proc = Bun.spawn(["bun", "run", "test:ulm-lab"], {
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
    expect(stdout).toContain("ulm_lab_replay: ok")
    expect(stdout).toContain("lab: k12-login-mfa-gap")
    expect(stdout).toContain("final_lint: ok")
    expect(stdout).toContain("report.pdf")
    expect(stdout).toContain("runtime-summary.json")
  })
})
