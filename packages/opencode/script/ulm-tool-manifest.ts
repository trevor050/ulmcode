#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"
import { acquireManifestTools } from "../src/ulm/tool-acquisition"

const packageRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(packageRoot, "../..")

function argValue(name: string) {
  const index = process.argv.lastIndexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const manifestPath = path.resolve(argValue("--manifest") ?? path.join(repoRoot, "tools/ulmcode-profile/tool-manifest.json"))
const worktree = path.resolve(argValue("--worktree") ?? repoRoot)
const operationID = argValue("--operation-id") ?? "tool-preflight"
const platform = argValue("--platform")
const json = process.argv.includes("--json")
const preflight = process.argv.includes("--preflight")
const install = process.argv.includes("--install")

type Safety = "non_destructive" | "interactive_destructive"

type ToolManifest = {
  version: number
  lastReviewed: string
  policy: {
    defaultSafetyMode: Safety
    destructiveSafetyMode: Safety
    installFailureBehavior: string
    notes: string[]
  }
  tools: Array<{
    id: string
    purpose: string
    safety: Safety
    install: Array<{ platform: string; command: string }>
    validate: string
    safeExamples: string[]
    outputParsers: string[]
    fallbacks: string[]
  }>
  commandProfiles: Array<{
    id: string
    tool: string
    safety: Safety
    template: string
    heartbeatSeconds: number
    idleTimeoutSeconds: number
    hardTimeoutSeconds: number
    restartable: boolean
    artifacts: string[]
  }>
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ToolManifest
assert(manifest.version >= 1, "manifest version must be >= 1")
assert(manifest.policy.defaultSafetyMode === "non_destructive", "default safety mode must be non_destructive")
assert(
  manifest.policy.destructiveSafetyMode === "interactive_destructive",
  "destructive safety mode must require interactive_destructive",
)
assert(
  manifest.policy.installFailureBehavior === "record_blocker_with_fallback",
  "install failures must become blockers with fallbacks",
)
if (!preflight) {
  assert(manifest.tools.length >= 6, "expected at least six tool entries")
  assert(manifest.commandProfiles.length >= 4, "expected at least four supervised command profiles")
}

const toolIDs = new Set<string>()
for (const tool of manifest.tools) {
  assert(/^[a-z0-9][a-z0-9-]*$/.test(tool.id), `${tool.id}: invalid tool id`)
  assert(!toolIDs.has(tool.id), `${tool.id}: duplicate tool id`)
  toolIDs.add(tool.id)
  assert(tool.purpose.length >= 12, `${tool.id}: purpose is too short`)
  assert(tool.install.length >= 1, `${tool.id}: install methods are required`)
  assert(tool.install.every((item) => item.platform && item.command), `${tool.id}: install entries need platform/command`)
  assert(tool.validate.length >= 3, `${tool.id}: validation command is required`)
  assert(tool.safeExamples.length >= 1, `${tool.id}: safe usage example is required`)
  assert(tool.outputParsers.length >= 1, `${tool.id}: output parser is required`)
  assert(tool.fallbacks.length >= 1, `${tool.id}: fallback path is required`)
}

for (const profile of manifest.commandProfiles) {
  assert(toolIDs.has(profile.tool), `${profile.id}: references unknown tool ${profile.tool}`)
  assert(profile.safety === "non_destructive", `${profile.id}: unattended profiles must be non_destructive`)
  assert(profile.template.includes("{outputPrefix}") || profile.artifacts.length >= 1, `${profile.id}: template or artifacts required`)
  assert(profile.template.length >= 8, `${profile.id}: command template is required`)
  assert(profile.heartbeatSeconds > 0, `${profile.id}: heartbeat must be positive`)
  assert(profile.idleTimeoutSeconds >= profile.heartbeatSeconds, `${profile.id}: idle timeout must cover heartbeat`)
  assert(profile.hardTimeoutSeconds >= profile.idleTimeoutSeconds, `${profile.id}: hard timeout must cover idle timeout`)
  assert(profile.artifacts.length >= 1, `${profile.id}: expected output artifacts are required`)
}

if (preflight) {
  const result = await acquireManifestTools({
    worktree,
    operationID,
    manifestPath,
    install,
    platform,
  })
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: result.blocked === 0,
          manifest: path.relative(repoRoot, manifestPath),
          preflight: result,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`ulm_tool_preflight: ${result.blocked === 0 ? "ok" : "blocked"} (${result.available}/${result.total} available)`)
    console.log(`summary: ${result.summaryPath}`)
    console.log(`markdown: ${result.markdownPath}`)
  }
} else if (json) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        manifest: path.relative(repoRoot, manifestPath),
        tools: manifest.tools.length,
        commandProfiles: manifest.commandProfiles.length,
      },
      null,
      2,
    ),
  )
} else {
  console.log(`ulm_tool_manifest: ok (${manifest.tools.length} tools, ${manifest.commandProfiles.length} profiles)`)
}
