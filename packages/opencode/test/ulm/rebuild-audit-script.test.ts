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

  test("prints a machine-readable rebuild checklist as JSON", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "script/ulm-rebuild-audit.ts", "--json"], {
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
    const result = JSON.parse(stdout) as {
      ok?: boolean
      checkedAt?: string
      checks?: Array<{ id?: string; status?: string; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(typeof result.checkedAt).toBe("string")
    expect(result.checks?.map((check) => check.id)).toEqual([
      "upstream_current",
      "operation_runtime",
      "report_quality",
      "profile_runtime",
      "lab_catalog",
      "required_gates",
    ])
    expect(result.checks?.every((check) => check.status === "ok" && typeof check.detail === "string")).toBe(true)
  })
})
