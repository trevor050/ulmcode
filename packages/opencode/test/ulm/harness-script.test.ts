import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packageRoot = path.join(__dirname, "../..")
const repoRoot = path.join(packageRoot, "../..")

describe("ULM harness runner script", () => {
  test("lists the required harness scenarios as JSON", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "script/ulm-harness-run.ts", "--list", "--json"], {
      cwd: packageRoot,
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
    const parsed = JSON.parse(stdout) as {
      scenarios?: Array<{ id?: string; capability?: string; tier?: string }>
    }
    expect(parsed.scenarios?.slice(0, 10).map((scenario) => scenario.capability)).toEqual([
      "model_loop_eval",
      "restart_resume_chaos",
      "installed_profile_runtime",
      "ulm_ci_gate",
      "longitudinal_scorecard",
      "prompt_agent_regression",
      "provider_tool_chaos",
      "dashboard_api_e2e",
      "deep_lab_target",
      "adversarial_report_quality",
    ])
    expect(parsed.scenarios?.some((scenario) => scenario.tier === "chaos")).toBe(true)
  })

  test("runs the fast harness and writes a scorecard artifact", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "script/ulm-harness-run.ts", "--tier", "fast", "--json"], {
      cwd: packageRoot,
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
    const parsed = JSON.parse(stdout) as {
      ok?: boolean
      output?: { json?: string; markdown?: string }
      coverage?: { missing?: string[] }
    }
    expect(parsed.ok).toBe(true)
    expect(parsed.coverage?.missing).toEqual([])
    expect(parsed.output?.json).toContain(".artifacts/ulm-harness")
    expect(parsed.output?.markdown).toContain(".artifacts/ulm-harness")
  })

  test("runs the chaos harness with full required coverage", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "script/ulm-harness-run.ts", "--tier", "chaos", "--json"], {
      cwd: packageRoot,
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
    const parsed = JSON.parse(stdout) as {
      ok?: boolean
      coverage?: { missing?: string[] }
      scenarios?: Array<{ tier?: string; capability?: string }>
    }
    expect(parsed.ok).toBe(true)
    expect(parsed.coverage?.missing).toEqual([])
    expect(parsed.scenarios?.some((scenario) => scenario.tier === "chaos")).toBe(true)
  })

  test("wires harness scripts into package, profile, and CI gates", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>
    }
    expect(packageJson.scripts?.["test:ulm-harness:fast"]).toBe("bun run script/ulm-harness-run.ts --tier fast")
    expect(packageJson.scripts?.["test:ulm-harness"]).toBe("bun run script/ulm-harness-run.ts --tier fast")
    expect(packageJson.scripts?.["test:ulm-harness:chaos"]).toBe(
      "bun run script/ulm-harness-run.ts --tier chaos",
    )

    const profileVerifier = await fs.readFile(path.join(repoRoot, "tools/ulmcode-profile/test-profile.sh"), "utf8")
    expect(profileVerifier).toContain("test:ulm-harness:fast")

    const workflow = await fs.readFile(path.join(repoRoot, ".github/workflows/ulm-harness.yml"), "utf8")
    expect(workflow).toContain("name: ulm-harness")
    expect(workflow).toContain("tools/ulmcode-profile/test-profile.sh")
    expect(workflow).toContain("test:ulm-harness:fast")
  })
})
