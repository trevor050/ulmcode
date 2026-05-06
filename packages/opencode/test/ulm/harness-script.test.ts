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
    expect(new Set(parsed.scenarios?.map((scenario) => scenario.capability))).toEqual(new Set([
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
    ]))
    expect(parsed.scenarios?.some((scenario) => scenario.tier === "chaos")).toBe(true)
    expect(parsed.scenarios?.some((scenario) => scenario.tier === "full")).toBe(true)
    expect(parsed.scenarios?.some((scenario) => scenario.tier === "overnight")).toBe(true)
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
    expect(packageJson.scripts?.["test:ulm-harness:full"]).toBe("bun run script/ulm-harness-run.ts --tier full")
    expect(packageJson.scripts?.["test:ulm-harness:chaos"]).toBe(
      "bun run script/ulm-harness-run.ts --tier chaos",
    )
    expect(packageJson.scripts?.["test:ulm-harness:overnight"]).toBe(
      "bun run script/ulm-harness-run.ts --tier overnight",
    )
    expect(packageJson.scripts?.["ulm:runtime-daemon"]).toBe("bun run script/ulm-runtime-daemon.ts")
    expect(packageJson.scripts?.["ulm:burnin"]).toBe("bun run script/ulm-burnin.ts")
    expect(packageJson.scripts?.["ulm:tool-preflight"]).toBe(
      "bun run script/ulm-tool-manifest.ts --preflight --operation-id tool-preflight",
    )
    expect(packageJson.scripts?.["test:ulm-tool-manifest"]).toBe("bun run script/ulm-tool-manifest.ts")

    const profileVerifier = await fs.readFile(path.join(repoRoot, "tools/ulmcode-profile/test-profile.sh"), "utf8")
    expect(profileVerifier).toContain("test:ulm-harness:fast")
    expect(profileVerifier).toContain("test:ulm-tool-manifest")

    const workflow = await fs.readFile(path.join(repoRoot, ".github/workflows/ulm-harness.yml"), "utf8")
    expect(workflow).toContain("name: ulm-harness")
    expect(workflow).toContain("tools/ulmcode-profile/test-profile.sh")
    expect(workflow).toContain("test:ulm-harness:fast")
  })

  test("overnight harness requires the accelerated burn-in proof path", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "script/ulm-harness-run.ts", "--tier", "overnight", "--json"], {
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
      scenarios?: Array<{ id?: string; checks?: Array<{ id?: string; status?: string }> }>
    }
    const overnight = parsed.scenarios?.find((scenario) => scenario.id === "overnight-readiness-contract")
    expect(parsed.ok).toBe(true)
    expect(overnight?.checks?.some((check) => check.id?.includes("ulm-burnin.ts") && check.status === "passed")).toBe(true)
    expect(overnight?.checks?.some((check) => check.id?.includes("burnin-proof.json") && check.status === "passed")).toBe(true)
    expect(overnight?.checks?.some((check) => check.id?.includes("runtime-supervisor.ts") && check.status === "passed")).toBe(true)
    expect(overnight?.checks?.some((check) => check.id?.includes("supervisor-install.md") && check.status === "passed")).toBe(true)
  })
})
