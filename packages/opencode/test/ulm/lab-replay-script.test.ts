import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packageRoot = path.join(__dirname, "../..")
const repoRoot = path.join(packageRoot, "../..")

describe("ULM lab replay script", () => {
  test("package command runs the full bundled lab catalog", async () => {
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
    expect(stdout).toContain("ulm_lab_catalog: ok")
    expect(stdout).toContain("lab: k12-login-mfa-gap")
    expect(stdout).toContain("lab: k12-roster-idor")
  })

  test("runs every bundled lab manifest", async () => {
    const labsRoot = path.join(repoRoot, "tools", "ulmcode-labs")
    const entries = await fs.readdir(labsRoot, { withFileTypes: true })
    const manifests = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const manifest = path.join(labsRoot, entry.name, "manifest.json")
            try {
              await fs.access(manifest)
              return manifest
            } catch {
              return undefined
            }
          }),
      )
    ).filter((manifest): manifest is string => manifest !== undefined)

    expect(manifests.length).toBeGreaterThanOrEqual(2)

    for (const manifest of manifests) {
      const proc = Bun.spawn(["bun", "run", "script/ulm-lab-replay.ts", manifest], {
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
      expect(stdout).toContain(`lab: ${path.basename(path.dirname(manifest))}`)
      expect(stdout).toContain("final_lint: ok")
      expect(stdout).toContain("operation_audit: ok")
      expect(stdout).toContain("report.pdf")
      expect(stdout).toContain("runtime-summary.json")
      expect(stdout).toContain("operation-audit.json")
    }
  })
})
