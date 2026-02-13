import type { Argv } from "yargs"
import path from "path"
import os from "os"
import { mkdir } from "fs/promises"
import { existsSync } from "fs"
import { cmd } from "./cmd"

type SkillPolicy = Record<string, "allow" | "deny">

export const ProfileCommand = cmd({
  command: "profile",
  describe: "manage ULMCode profiles (skills + strict config)",
  builder: (yargs: Argv) => yargs.command(ProfileInitCommand).demandCommand(),
  async handler() {},
})

export function defaultProfileMcp() {
  return {
    // Intentionally NOT shipping with Vercel MCP by default.
    // (Keep the default profile as boring as possible: fewer auth prompts, less noise.)
    context7: { type: "remote", url: "https://mcp.context7.com/mcp" },
    playwright: { type: "local", command: ["npx", "@playwright/mcp@latest"] },
    pentestMCP: { type: "local", command: ["docker", "run", "--rm", "-i", "ramgameer/pentest-mcp:latest"] },
  } as const
}

const ProfileInitCommand = cmd({
  command: "init",
  describe: "initialize a strict ULMCode profile directory (skills, MCP, launchers, config)",
  builder: (yargs: Argv) =>
    yargs
      .option("dir", {
        alias: "d",
        type: "string",
        describe: "profile directory (default: ~/.config/ulmcode)",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "overwrite existing profile files (opencode.json, launchers)",
      }),
  handler: async (args: { dir?: string; force: boolean }) => {
    const profileDir = path.resolve(args.dir ?? path.join(os.homedir(), ".config", "ulmcode"))
    const skillsDir = path.join(profileDir, "skills")

    // Expected by our skills bundle + docs.
    const pentestRoot = path.join(skillsDir, "pentest-compact")
    const defensiveRoot = path.join(skillsDir, "defensive-compact")
    const skillRoots = [pentestRoot, ...(existsSync(defensiveRoot) ? [defensiveRoot] : [])]

    for (const root of skillRoots) {
      if (!existsSync(root)) {
        throw new Error(
          `missing skill root: ${root}\n` +
            `expected skills under: ${skillsDir}\n` +
            `install the skills bundle first (or copy skills into place) and retry`,
        )
      }
    }

    await mkdir(profileDir, { recursive: true })

    const configPath = path.join(profileDir, "opencode.json")
    const launcherShPath = path.join(profileDir, "ulmcode-launch.sh")
    const launcherPs1Path = path.join(profileDir, "ulmcode-launch.ps1")

    if (!args.force) {
      const exists = [configPath, launcherShPath, launcherPs1Path].filter((p) => existsSync(p))
      if (exists.length > 0) {
        throw new Error(
          `profile already looks initialized:\n` +
            exists.map((p) => `- ${p}`).join("\n") +
            `\nre-run with --force to overwrite`,
        )
      }
    }

    const skillNames = await discoverSkillNames(skillRoots)

    const skillPolicy: SkillPolicy = { "*": "deny" }
    for (const name of skillNames) skillPolicy[name] = "allow"

    const config = {
      $schema: "https://opencode.ai/config.json",
      skills: {
        paths: skillRoots,
      },
      permission: {
        skill: skillPolicy,
      },
      // Enabled by default (we warn if deps are missing, but don't hard-fail).
      mcp: defaultProfileMcp(),
    } as const

    await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n")

    const launcherSh =
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'PROFILE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
        "",
        'export OPENCODE_CONFIG_DIR="$PROFILE_DIR"',
        'export OPENCODE_CONFIG="$PROFILE_DIR/opencode.json"',
        "export OPENCODE_DISABLE_EXTERNAL_SKILLS=1",
        "export OPENCODE_DISABLE_PROJECT_CONFIG=1",
        "",
        "# Run ULMCode if available; fallback to opencode.",
        "if command -v ulmcode >/dev/null 2>&1; then",
        '  exec ulmcode "$@"',
        "fi",
        'exec opencode "$@"',
        "",
      ].join("\n") + "\n"
    await Bun.write(launcherShPath, launcherSh)
    await Bun.$`chmod +x ${launcherShPath}`.quiet()

    await Bun.write(
      launcherPs1Path,
      `param(\n  [Parameter(ValueFromRemainingArguments=$true)]\n  [string[]]$Args\n)\n\n$ProfileDir = Split-Path -Parent $MyInvocation.MyCommand.Path\n\n$env:OPENCODE_CONFIG_DIR = $ProfileDir\n$env:OPENCODE_CONFIG = Join-Path $ProfileDir 'opencode.json'\n$env:OPENCODE_DISABLE_EXTERNAL_SKILLS = '1'\n$env:OPENCODE_DISABLE_PROJECT_CONFIG = '1'\n\n$ulm = Get-Command ulmcode -ErrorAction SilentlyContinue\nif ($ulm) {\n  & $ulm.Source @Args\n  exit $LASTEXITCODE\n}\n\n$oc = Get-Command opencode -ErrorAction SilentlyContinue\nif ($oc) {\n  & $oc.Source @Args\n  exit $LASTEXITCODE\n}\n\nWrite-Error 'Neither ulmcode nor opencode was found in PATH.'\nexit 1\n`,
    )

    const missing: string[] = []
    if (!Bun.which("node") && !Bun.which("npx")) missing.push("node/npm (for Playwright MCP via npx)")
    if (!Bun.which("docker")) missing.push("docker (for pentestMCP)")

    console.log("[ok] wrote", configPath)
    console.log("[ok] wrote", launcherShPath)
    console.log("[ok] wrote", launcherPs1Path)
    console.log("[ok] allowlisted skills:", skillNames.length)
    if (missing.length) {
      console.warn("[warn] missing optional dependencies:")
      for (const m of missing) console.warn(" -", m)
    }
  },
})

async function discoverSkillNames(skillRoots: string[]): Promise<string[]> {
  const names: string[] = []
  const seen = new Set<string>()
  const nameRe = /^name:\s*(.+)$/m

  for (const root of skillRoots) {
    const files = await Array.fromAsync(new Bun.Glob("**/SKILL.md").scan({ cwd: root, onlyFiles: true }))
    for (const rel of files) {
      const full = path.join(root, rel)
      const text = await Bun.file(full).text().catch(() => "")
      const match = text.match(nameRe)
      if (!match) continue
      const name = match[1].trim().replace(/^"(.*)"$/, "$1")
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }

  names.sort()
  return names
}
