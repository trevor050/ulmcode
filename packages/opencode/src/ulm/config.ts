import fs from "fs/promises"
import path from "path"

export type ULMRuntimeConfig = {
  operator_timeout_seconds?: number
}

export const ULM_CONFIG_FILE = "ULMconfig.toml"

function stripComment(line: string) {
  let quote: '"' | "'" | undefined
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if ((ch === '"' || ch === "'") && line[i - 1] !== "\\") {
      quote = quote === ch ? undefined : quote ?? ch
      continue
    }
    if (ch === "#" && !quote) return line.slice(0, i)
  }
  return line
}

function parseValue(raw: string) {
  const value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  if (value === "true") return true
  if (value === "false") return false
  const number = Number(value)
  if (Number.isFinite(number)) return number
  return value
}

function normalizeOperatorTimeout(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return value
}

export function parseULMConfigToml(text: string): ULMRuntimeConfig {
  let section = ""
  const result: ULMRuntimeConfig = {}

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      continue
    }
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!match) continue

    const key = section ? `${section}.${match[1]}` : match[1]
    const value = parseValue(match[2])
    if (key === "operator_timeout_seconds") {
      const seconds = normalizeOperatorTimeout(value)
      if (seconds !== undefined) result.operator_timeout_seconds = seconds
    }
  }

  return result
}

function candidateFiles(directory: string, worktree?: string) {
  const start = path.resolve(directory)
  const stop = worktree ? path.resolve(worktree) : undefined
  const dirs: string[] = []
  for (let dir = start; ; dir = path.dirname(dir)) {
    dirs.push(dir)
    if (dir === stop || dir === path.dirname(dir)) break
  }
  if (stop && !dirs.includes(stop)) dirs.push(stop)
  return dirs.map((dir) => path.join(dir, ULM_CONFIG_FILE)).reverse()
}

async function readFile(file: string) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

export async function readULMConfig(input: { directory: string; worktree?: string }): Promise<ULMRuntimeConfig> {
  const configs = await Promise.all(
    candidateFiles(input.directory, input.worktree).map(async (file) => {
      const text = await readFile(file)
      if (!text) return {}
      try {
        return parseULMConfigToml(text)
      } catch {
        return {}
      }
    }),
  )
  return Object.assign({}, ...configs)
}
