#!/usr/bin/env bun
import { formatBurnInHarness, runBurnInHarness } from "../src/ulm/burnin-harness"

type Args = {
  operationID: string
  targetSeconds: number
  tickSeconds: number
  maxTicks?: number
  reset: boolean
  json: boolean
}

function usage() {
  return [
    "Usage: bun run script/ulm-burnin.ts <operationID> [options]",
    "",
    "Options:",
    "  --target-hours <n>    Simulated wall-clock target. Defaults to 20.",
    "  --target-seconds <n>  Simulated wall-clock target in seconds.",
    "  --tick-seconds <n>    Simulated seconds advanced per daemon/scheduler tick. Defaults to 900.",
    "  --max-ticks <n>       Stop early after this many ticks, leaving a resume checkpoint.",
    "  --reset               Remove prior burn-in state before running.",
    "  --json                Print machine-readable JSON.",
  ].join("\n")
}

function numberOption(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} requires a value`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

function parseArgs(argv: string[]): Args {
  const args = [...argv]
  const operationID = args.shift()
  if (!operationID || operationID === "--help" || operationID === "-h") {
    console.log(usage())
    process.exit(operationID ? 0 : 1)
  }

  let targetSeconds = 20 * 60 * 60
  let tickSeconds = 15 * 60
  let maxTicks: number | undefined
  let reset = false
  let json = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--json") {
      json = true
    } else if (arg === "--reset") {
      reset = true
    } else if (arg === "--target-hours") {
      targetSeconds = numberOption(arg, args[++index]) * 60 * 60
    } else if (arg === "--target-seconds") {
      targetSeconds = numberOption(arg, args[++index])
    } else if (arg === "--tick-seconds") {
      tickSeconds = numberOption(arg, args[++index])
    } else if (arg === "--max-ticks") {
      maxTicks = numberOption(arg, args[++index])
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }

  return { operationID, targetSeconds, tickSeconds, maxTicks, reset, json }
}

try {
  const args = parseArgs(process.argv.slice(2))
  const result = await runBurnInHarness(process.cwd(), {
    operationID: args.operationID,
    targetElapsedSeconds: args.targetSeconds,
    tickSeconds: args.tickSeconds,
    maxTicks: args.maxTicks,
    reset: args.reset,
  })
  console.log(args.json ? JSON.stringify(result, null, 2) : formatBurnInHarness(result))
  process.exit(result.audit.status === "failed" ? 2 : 0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
