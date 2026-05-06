import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const packageRoot = import.meta.dir + "/../.."

async function writeFixtureFile(root: string, relative: string, content: string) {
  const target = path.join(root, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

async function makeAuditFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-rebuild-audit-"))
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/package.json",
    JSON.stringify({
      dependencies: {
        "oh-my-openagent": "file:plugins/vendor/oh-my-openagent-3.17.12",
        "oh-my-opencode": "file:plugins/vendor/oh-my-openagent-3.17.12",
      },
    }),
  )
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/opencode.json",
    JSON.stringify({ plugin: ["oh-my-openagent"] }),
  )
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/plugins/ulmcode-runtime-guard.js",
    "operation_resume runtime_summary operation_recover report_lint",
  )
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/scripts/install-profile.sh",
    "cp ulmcode-launch.sh oh-my-openagent.jsonc local-opencode tool-manifest.json",
  )
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/plugins/vendor/oh-my-openagent-3.17.12/dist/index.js",
    "module.exports = {}",
  )
  await writeFixtureFile(
    root,
    "packages/opencode/package.json",
    JSON.stringify({
      scripts: {
        "test:ulm-harness:fast": "bun run script/ulm-harness-run.ts --tier fast",
        "test:ulm-harness:overnight": "bun run script/ulm-harness-run.ts --tier overnight",
      },
    }),
  )
  await writeFixtureFile(
    root,
    ".github/workflows/ulm-harness.yml",
    [
      "name: ulm-harness",
      "on:",
      "  workflow_dispatch:",
      "  schedule:",
      "    - cron: \"17 9 * * *\"",
      "jobs:",
      "  overnight:",
      "    steps:",
      "      - run: bun run --cwd packages/opencode test:ulm-harness:overnight",
    ].join("\n"),
  )
  return root
}

async function writeToolManifest(root: string, commandProfiles: unknown[]) {
  await writeFixtureFile(
    root,
    "tools/ulmcode-profile/tool-manifest.json",
    JSON.stringify(
      {
        version: 1,
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
        },
        tools: [
          {
            id: "nmap",
            purpose: "service inventory and version fingerprinting",
            safety: "non_destructive",
            install: [{ platform: "darwin", command: "brew install nmap" }],
            validate: "nmap --version",
            safeExamples: ["nmap -sV -oA {outputPrefix} {target}"],
            outputParsers: ["xml"],
            fallbacks: ["httpx"],
          },
          {
            id: "httpx",
            purpose: "HTTP discovery and inventory",
            safety: "non_destructive",
            install: [{ platform: "go", command: "go install httpx" }],
            validate: "httpx -version",
            safeExamples: ["httpx -l hosts.txt -json -o {outputPrefix}.jsonl"],
            outputParsers: ["jsonl"],
            fallbacks: ["curl"],
          },
          {
            id: "ffuf",
            purpose: "authorized content discovery",
            safety: "non_destructive",
            install: [{ platform: "darwin", command: "brew install ffuf" }],
            validate: "ffuf -V",
            safeExamples: ["ffuf -u {url}/FUZZ -w {wordlist} -o {outputPrefix}.json"],
            outputParsers: ["json"],
            fallbacks: ["manual-review"],
          },
          {
            id: "zap-baseline",
            purpose: "passive web baseline checks",
            safety: "non_destructive",
            install: [{ platform: "docker", command: "docker pull zaproxy/zap-stable" }],
            validate: "docker image inspect zaproxy/zap-stable",
            safeExamples: ["zap-baseline.py -t {url} -J {outputPrefix}.json"],
            outputParsers: ["json"],
            fallbacks: ["manual-browser-review"],
          },
        ],
        commandProfiles,
      },
      null,
      2,
    ),
  )
}

describe("ULM rebuild audit script", () => {
  test("validates the rebuild evidence checklist", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "test:ulm-rebuild-audit"], {
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
    expect(stdout).toContain("ulm_rebuild_audit: ok")
    expect(stdout).toContain("upstream_current: ok")
    expect(stdout).toContain("operation_runtime: ok")
    expect(stdout).toContain("report_quality: ok")
    expect(stdout).toContain("profile_routing: ok")
    expect(stdout).toContain("profile_runtime: ok")
    expect(stdout).toContain("lab_catalog: ok")
    expect(stdout).toContain("required_gates: ok")
  })

  test("prints a machine-readable rebuild checklist as JSON", async () => {
    const proc = Bun.spawn(["bun", "run", "--silent", "script/ulm-rebuild-audit.ts", "--json"], {
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
      "profile_routing",
      "profile_runtime",
      "lab_catalog",
      "required_gates",
      "harness_scheduler",
    ])
    expect(result.checks?.every((check) => check.status === "ok" && typeof check.detail === "string")).toBe(true)
  })

  test("fails profile runtime audit when the tool manifest has no supervised command profiles", async () => {
    const root = await makeAuditFixture()
    await writeToolManifest(root, [])

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "--silent",
        "script/ulm-rebuild-audit.ts",
        "--repo-root",
        root,
        "--check",
        "profile_runtime",
      ],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).not.toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toContain("expected at least four supervised command profiles")
  })

  test("fails harness scheduler audit when scheduled overnight artifacts are missing", async () => {
    const root = await makeAuditFixture()
    await writeToolManifest(root, [
      {
        id: "service-inventory",
        tool: "nmap",
        safety: "non_destructive",
        template: "nmap -sV -oA {outputPrefix} {target}",
        heartbeatSeconds: 60,
        idleTimeoutSeconds: 120,
        hardTimeoutSeconds: 180,
        restartable: true,
        artifacts: ["evidence/raw/nmap.xml"],
      },
      {
        id: "http-discovery",
        tool: "httpx",
        safety: "non_destructive",
        template: "httpx -l {inputFile} -json -o {outputPrefix}.jsonl",
        heartbeatSeconds: 60,
        idleTimeoutSeconds: 120,
        hardTimeoutSeconds: 180,
        restartable: true,
        artifacts: ["evidence/raw/httpx.jsonl"],
      },
      {
        id: "content-discovery",
        tool: "ffuf",
        safety: "non_destructive",
        template: "ffuf -u {url}/FUZZ -w {wordlist} -o {outputPrefix}.json",
        heartbeatSeconds: 60,
        idleTimeoutSeconds: 120,
        hardTimeoutSeconds: 180,
        restartable: true,
        artifacts: ["evidence/raw/ffuf.json"],
      },
      {
        id: "passive-web-baseline",
        tool: "zap-baseline",
        safety: "non_destructive",
        template: "zap-baseline.py -t {url} -J {outputPrefix}.json",
        heartbeatSeconds: 60,
        idleTimeoutSeconds: 120,
        hardTimeoutSeconds: 180,
        restartable: false,
        artifacts: ["evidence/raw/zap.json"],
      },
    ])
    await writeFixtureFile(root, ".github/workflows/ulm-harness.yml", "name: ulm-harness\non:\n  pull_request:\n")

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "--silent",
        "script/ulm-rebuild-audit.ts",
        "--repo-root",
        root,
        "--check",
        "harness_scheduler",
      ],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).not.toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toContain(".github/workflows/ulm-harness.yml: missing schedule:")
  })
})
