import fs from "fs/promises"
import path from "path"
import type { OperationGoalRecord } from "./operation-goal"

export type ULMRuntimeConfig = {
  continuation_enabled?: boolean
  turn_end_review?: boolean
  max_no_tool_continuation_turns?: number
  inject_plan_max_chars?: number
  operator_fallback_enabled?: boolean
  operator_timeout_seconds?: number
  max_repeated_operator_timeouts_per_kind?: number
}

export const ULM_CONFIG_FILE = "ULMconfig.toml"

export function effectiveULMContinuation(goal: OperationGoalRecord, config: ULMRuntimeConfig = {}) {
  return {
    enabled: config.continuation_enabled ?? goal.continuation?.enabled ?? true,
    turnEndReview: config.turn_end_review ?? goal.continuation?.turnEndReview ?? true,
    maxNoToolContinuationTurns:
      config.max_no_tool_continuation_turns ?? goal.continuation?.maxNoToolContinuationTurns ?? 1,
    injectPlanMaxChars: config.inject_plan_max_chars ?? goal.continuation?.injectPlanMaxChars ?? 12_000,
    operatorFallbackEnabled: config.operator_fallback_enabled ?? goal.continuation?.operatorFallbackEnabled ?? true,
    maxRepeatedOperatorTimeoutsPerKind:
      config.max_repeated_operator_timeouts_per_kind ?? goal.continuation?.maxRepeatedOperatorTimeoutsPerKind ?? 2,
  }
}

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

function normalizeNonNegativeInteger(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function normalizePositiveInteger(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined
  return Math.floor(value)
}

function normalizeBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined
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
    if (key === "continuation_enabled") {
      result.continuation_enabled = normalizeBoolean(value) ?? result.continuation_enabled
    }
    if (key === "turn_end_review") {
      result.turn_end_review = normalizeBoolean(value) ?? result.turn_end_review
    }
    if (key === "max_no_tool_continuation_turns") {
      result.max_no_tool_continuation_turns =
        normalizeNonNegativeInteger(value) ?? result.max_no_tool_continuation_turns
    }
    if (key === "inject_plan_max_chars") {
      result.inject_plan_max_chars = normalizePositiveInteger(value) ?? result.inject_plan_max_chars
    }
    if (key === "operator_fallback_enabled") {
      result.operator_fallback_enabled = normalizeBoolean(value) ?? result.operator_fallback_enabled
    }
    if (key === "operator_timeout_seconds") {
      result.operator_timeout_seconds = normalizeOperatorTimeout(value) ?? result.operator_timeout_seconds
    }
    if (key === "max_repeated_operator_timeouts_per_kind") {
      result.max_repeated_operator_timeouts_per_kind =
        normalizeNonNegativeInteger(value) ?? result.max_repeated_operator_timeouts_per_kind
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
