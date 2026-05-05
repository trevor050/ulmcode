#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../..")
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
)
  .filter((manifest): manifest is string => manifest !== undefined)
  .toSorted((a, b) => a.localeCompare(b))

if (manifests.length === 0) throw new Error(`No lab manifests found under ${labsRoot}`)

const results: string[] = []
for (const manifest of manifests) {
  const proc = Bun.spawn(["bun", "run", "script/ulm-lab-replay.ts", manifest], {
    cwd: path.join(repoRoot, "packages", "opencode"),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error([`Lab replay failed for ${manifest}`, stderr.trim(), stdout.trim()].filter(Boolean).join("\n"))
  }
  results.push(stdout.trim())
}

console.log("ulm_lab_catalog: ok")
console.log(`labs: ${manifests.length}`)
for (const result of results) console.log(result)
