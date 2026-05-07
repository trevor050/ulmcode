import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { acquireManifestTools, acquireTool } from "@/ulm/tool-acquisition"
import { tmpdir } from "../fixture/fixture"

async function writeManifest(root: string, validate: string) {
  const manifest = path.join(root, "manifest.json")
  await fs.writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      lastReviewed: "2026-05-05",
      policy: {
        defaultSafetyMode: "non_destructive",
        destructiveSafetyMode: "interactive_destructive",
        installFailureBehavior: "record_blocker_with_fallback",
        notes: [],
      },
      tools: [
        {
          id: "fake-tool",
          purpose: "fixture tool",
          safety: "non_destructive",
          install: [{ platform: "test", command: "echo install fake-tool" }],
          validate,
          safeExamples: ["fake-tool --help"],
          outputParsers: ["text"],
          fallbacks: ["manual-review"],
        },
      ],
      commandProfiles: [],
    }),
  )
  return manifest
}

async function writeMultiToolManifest(root: string) {
  const manifest = path.join(root, "manifest.json")
  await fs.writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      lastReviewed: "2026-05-05",
      policy: {
        defaultSafetyMode: "non_destructive",
        destructiveSafetyMode: "interactive_destructive",
        installFailureBehavior: "record_blocker_with_fallback",
        notes: [],
      },
      tools: [
        {
          id: "available-tool",
          purpose: "fixture available tool",
          safety: "non_destructive",
          install: [{ platform: "test", command: "echo install available" }],
          validate: "printf ok",
          safeExamples: ["available-tool --help"],
          outputParsers: ["text"],
          fallbacks: ["manual-review"],
        },
        {
          id: "missing-tool",
          purpose: "fixture missing tool",
          safety: "non_destructive",
          install: [{ platform: "test", command: "echo install missing" }],
          validate: "exit 127",
          safeExamples: ["missing-tool --help"],
          outputParsers: ["text"],
          fallbacks: ["available-tool", "manual-review"],
        },
      ],
      commandProfiles: [],
    }),
  )
  return manifest
}

describe("ULM tool acquisition", () => {
  test("records available tools after validation succeeds", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = await writeManifest(dir.path, "printf ok")

    const result = await acquireTool({
      worktree: dir.path,
      operationID: "School",
      toolID: "fake-tool",
      manifestPath,
    })

    expect(result.available).toBe(true)
    expect(result.installed).toBe(false)
    expect(result.blocker).toBeUndefined()
    expect(await fs.readFile(result.recordPath, "utf8")).toContain('"available": true')
  })

  test("records blockers and fallbacks when validation fails without install", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = await writeManifest(dir.path, "exit 127")

    const result = await acquireTool({
      worktree: dir.path,
      operationID: "School",
      toolID: "fake-tool",
      manifestPath,
    })

    expect(result.available).toBe(false)
    expect(result.installed).toBe(false)
    expect(result.blocker).toContain("validation failed")
    expect(result.fallbacks).toEqual(["manual-review"])
    expect(await fs.readFile(result.recordPath, "utf8")).toContain("manual-review")
  })

  test("writes a manifest-level clean-machine preflight summary without installing by default", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = await writeMultiToolManifest(dir.path)

    const result = await acquireManifestTools({
      worktree: dir.path,
      operationID: "School",
      manifestPath,
      install: false,
      platform: "test",
    })

    expect(result.total).toBe(2)
    expect(result.available).toBe(1)
    expect(result.blocked).toBe(1)
    expect(result.installAttempted).toBe(false)
    expect(result.tools.find((tool) => tool.toolID === "missing-tool")?.fallbacks).toEqual([
      "available-tool",
      "manual-review",
    ])
    expect(await fs.readFile(result.summaryPath, "utf8")).toContain('"blocked": 1')
    const markdown = await fs.readFile(result.markdownPath, "utf8")
    expect(markdown).toContain("missing-tool")
    expect(markdown).toContain("## Blocked Install Plan")
    expect(markdown).toContain("echo install missing")
  })

  test("runs manifest preflight through the operator script", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = await writeMultiToolManifest(dir.path)
    const script = path.join(__dirname, "..", "..", "script", "ulm-tool-manifest.ts")
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        script,
        "--manifest",
        manifestPath,
        "--worktree",
        dir.path,
        "--operation-id",
        "School",
        "--preflight",
        "--platform",
        "test",
        "--json",
      ],
      { cwd: dir.path, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.preflight.blocked).toBe(1)
    expect(parsed.preflight.summaryPath).toContain("tool-preflight.json")
  })
})
