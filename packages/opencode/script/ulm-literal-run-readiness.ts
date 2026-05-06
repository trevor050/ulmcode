#!/usr/bin/env bun

import path from "path"
import { auditLiteralRunReadiness, formatLiteralRunReadiness } from "../src/ulm/literal-run-readiness"

function hasArg(name: string) {
  return process.argv.includes(name)
}

function readArg(name: string) {
  const index = process.argv.lastIndexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function readNumberArg(name: string) {
  const raw = readArg(name)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

const positionalOperation = process.argv.find(
  (arg, index) => index > 1 && !arg.startsWith("--") && !process.argv[index - 1]?.startsWith("--"),
)
const operationID = readArg("--operation-id") ?? positionalOperation ?? "literal-run"
const worktree = path.resolve(readArg("--worktree") ?? process.cwd())
const targetElapsedSeconds = readNumberArg("--target-seconds")

const result = await auditLiteralRunReadiness(worktree, {
  operationID,
  targetElapsedSeconds,
})

if (hasArg("--json")) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
} else {
  process.stdout.write(formatLiteralRunReadiness(result) + "\n")
}

if (hasArg("--strict") && result.status !== "passed") process.exit(1)
