import { describe, expect, test } from "bun:test"
import path from "path"

const packageRoot = path.join(__dirname, "../..")

describe("ULM lab target smoke script", () => {
  test("starts and probes the bundled vulnerable lab target", async () => {
    const proc = Bun.spawn(["bun", "run", "test:ulm-lab-target"], {
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
    expect(stdout).toContain("ulm_lab_target: ok")
    expect(stdout).toContain("target: k12-login-mfa-gap")
    expect(stdout).toContain("weak_privileged_mfa: confirmed")
    expect(stdout).toContain("target: k12-roster-idor")
    expect(stdout).toContain("cross_tenant_roster_read: confirmed")
    expect(stdout).toContain("target: k12-gradebook-mass-assignment")
    expect(stdout).toContain("student_grade_mass_assignment: confirmed")
    expect(stdout).toContain("target: k12-password-reset-token-leak")
    expect(stdout).toContain("password_reset_token_leak: confirmed")
    expect(stdout).toContain("target: k12-lti-shared-secret-leak")
    expect(stdout).toContain("forged_lti_instructor_launch: confirmed")
  })
})
