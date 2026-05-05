import { describe, expect, test } from "bun:test"

describe("ULM rebuild audit script", () => {
  test("validates the rebuild evidence checklist", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "test:ulm-rebuild-audit"], {
      cwd: import.meta.dir + "/../..",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("ulm_rebuild_audit: ok")
    expect(stdout).toContain("upstream_current: ok")
    expect(stdout).toContain("operation_runtime: ok")
    expect(stdout).toContain("report_quality: ok")
    expect(stdout).toContain("profile_runtime: ok")
    expect(stdout).toContain("lab_catalog: ok")
    expect(stdout).toContain("required_gates: ok")
  })
})
