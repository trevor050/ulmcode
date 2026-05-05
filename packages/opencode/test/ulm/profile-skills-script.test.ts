import { describe, expect, test } from "bun:test"

describe("ULM profile skills verifier", () => {
  test("validates the bundled profile skill pack", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "test:ulm-skills"], {
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
    expect(stdout).toContain("ulm_profile_skills: ok")
    expect(stdout).toContain("skills: 6")
    expect(stdout).toContain("commands: 3")
  })
})
