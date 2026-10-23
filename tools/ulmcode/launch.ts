#!/usr/bin/env bun

import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { applyRuntimeEnv, resolveProfilePaths, runtimeEnv } from "../../packages/ulm/src/profile.js"

const profile = resolveProfilePaths({ root: process.env.ULMCODE_PROFILE_ROOT })
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const pluginDirectory = path.join(repoRoot, "packages", "ulm")
applyRuntimeEnv(process.env, runtimeEnv(process.env, profile))

await fs.mkdir(profile.root, { recursive: true, mode: 0o700 })
await fs.chmod(profile.root, 0o700)
await fs.mkdir(profile.configDir, { recursive: true, mode: 0o700 })
await fs.chmod(profile.configDir, 0o700)
await fs.mkdir(profile.privateDir, { recursive: true, mode: 0o700 })
await fs.chmod(profile.privateDir, 0o700)
if (!(await Bun.file(profile.configFile).exists())) {
  const config = (await Bun.file(path.join(path.dirname(fileURLToPath(import.meta.url)), "profile.json")).json()) as Record<string, unknown>
  config.plugins = [pluginDirectory]
  await fs.writeFile(profile.configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await fs.chmod(profile.configFile, 0o600)
}

const cliRoot = path.join(repoRoot, "packages", "cli")
const cliEntry = path.join(cliRoot, "src", "index.ts")
const child = spawn(process.execPath, [cliEntry, ...process.argv.slice(2)], {
  cwd: cliRoot,
  env: process.env,
  stdio: "inherit",
})
const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
  child.once("error", reject)
  child.once("exit", (code, signal) => resolve({ code, signal }))
})
if (result.signal) process.kill(process.pid, result.signal)
else process.exitCode = result.code ?? 1
