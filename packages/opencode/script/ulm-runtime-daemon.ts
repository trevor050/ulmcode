#!/usr/bin/env bun
import { formatRuntimeDaemon, runRuntimeDaemon } from "../src/ulm/runtime-daemon"
import { writeRuntimeSupervisor, type RuntimeSupervisorKind } from "../src/ulm/runtime-supervisor"
import { operationPath, slug } from "../src/ulm/artifact"
import { spawn } from "child_process"
import { closeSync, mkdirSync, openSync, writeFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

type Args = {
  operationID: string
  durationSeconds: number
  intervalSeconds: number
  maxCycles?: number
  schedulerCyclesPerTick: number
  leaseSeconds?: number
  errorBackoffSeconds?: number
  maxConsecutiveErrors?: number
  staleLockSeconds?: number
  supervisorEnabled?: boolean
  supervisorIntervalMinutes?: number
  supervisorReviewKind?: "startup" | "heartbeat" | "pre_compaction" | "post_compaction" | "pre_handoff" | "manual"
  detach: boolean
  detachLog?: string
  supervisor?: RuntimeSupervisorKind
  json: boolean
}

function usage() {
  return [
    "Usage: bun run script/ulm-runtime-daemon.ts <operationID> [options]",
    "",
    "Options:",
    "  --duration-hours <n>        Wall-clock runtime window. Defaults to 20.",
    "  --duration-seconds <n>      Wall-clock runtime window in seconds.",
    "  --interval-seconds <n>      Sleep between scheduler ticks. Defaults to 60.",
    "  --max-cycles <n>            Stop after this many daemon ticks.",
    "  --scheduler-cycles <n>      Scheduler cycles per daemon tick. Defaults to 1.",
    "  --lease-seconds <n>         Requeue unbound claimed work units after this lease.",
    "  --error-backoff-seconds <n> Sleep after a failed scheduler tick. Defaults to 30.",
    "  --max-consecutive-errors <n> Stop after this many scheduler failures. Defaults to 3.",
    "  --stale-lock-seconds <n>    Replace daemon locks older than this. Defaults to 900.",
    "  --supervisor-interval-minutes <n>  Supervisor review cadence for long operations. Defaults to 30.",
    "  --supervisor-review-kind <kind>    startup, heartbeat, pre_compaction, post_compaction, pre_handoff, or manual.",
    "  --disable-operation-supervisor     Disable scheduler supervisor reviews even for long operations.",
    "  --detach                    Launch the 20-hour daemon in the background and return pid/log paths.",
    "  --detach-log <path>          Log file for detached stdout/stderr. Defaults under the operation scheduler dir.",
    "  --supervisor <kind>          Write OS supervisor artifacts: launchd, systemd, or all. Does not start the daemon.",
    "  --json                      Print machine-readable result JSON.",
  ].join("\n")
}

function numberOption(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} requires a value`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

function parseArgs(argv: string[]): Args {
  const args = [...argv]
  const operationID = args.shift()
  if (!operationID || operationID === "--help" || operationID === "-h") {
    console.log(usage())
    process.exit(operationID ? 0 : 1)
  }

  let durationSeconds = 20 * 60 * 60
  let intervalSeconds = 60
  let maxCycles: number | undefined
  let schedulerCyclesPerTick = 1
  let leaseSeconds: number | undefined
  let errorBackoffSeconds: number | undefined
  let maxConsecutiveErrors: number | undefined
  let staleLockSeconds: number | undefined
  let supervisorEnabled: boolean | undefined
  let supervisorIntervalMinutes: number | undefined
  let supervisorReviewKind: Args["supervisorReviewKind"]
  let detach = false
  let detachLog: string | undefined
  let supervisor: RuntimeSupervisorKind | undefined
  let json = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--json") {
      json = true
    } else if (arg === "--detach") {
      detach = true
    } else if (arg === "--detach-log") {
      detachLog = args[++index]
      if (!detachLog) throw new Error(`${arg} requires a value`)
    } else if (arg === "--supervisor") {
      const value = args[++index]
      if (value !== "launchd" && value !== "systemd" && value !== "all") {
        throw new Error(`${arg} must be launchd, systemd, or all`)
      }
      supervisor = value
    } else if (arg === "--disable-operation-supervisor") {
      supervisorEnabled = false
    } else if (arg === "--supervisor-interval-minutes") {
      supervisorIntervalMinutes = numberOption(arg, args[++index])
    } else if (arg === "--supervisor-review-kind") {
      const value = args[++index]
      if (
        value !== "startup" &&
        value !== "heartbeat" &&
        value !== "pre_compaction" &&
        value !== "post_compaction" &&
        value !== "pre_handoff" &&
        value !== "manual"
      ) {
        throw new Error(`${arg} must be startup, heartbeat, pre_compaction, post_compaction, pre_handoff, or manual`)
      }
      supervisorReviewKind = value
    } else if (arg === "--duration-hours") {
      durationSeconds = numberOption(arg, args[++index]) * 60 * 60
    } else if (arg === "--duration-seconds") {
      durationSeconds = numberOption(arg, args[++index])
    } else if (arg === "--interval-seconds") {
      intervalSeconds = numberOption(arg, args[++index])
    } else if (arg === "--max-cycles") {
      maxCycles = numberOption(arg, args[++index])
    } else if (arg === "--scheduler-cycles") {
      schedulerCyclesPerTick = numberOption(arg, args[++index])
    } else if (arg === "--lease-seconds") {
      leaseSeconds = numberOption(arg, args[++index])
    } else if (arg === "--error-backoff-seconds") {
      errorBackoffSeconds = numberOption(arg, args[++index])
    } else if (arg === "--max-consecutive-errors") {
      maxConsecutiveErrors = numberOption(arg, args[++index])
    } else if (arg === "--stale-lock-seconds") {
      staleLockSeconds = numberOption(arg, args[++index])
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }

  return {
    operationID,
    durationSeconds,
    intervalSeconds,
    maxCycles,
    schedulerCyclesPerTick,
    leaseSeconds,
    errorBackoffSeconds,
    maxConsecutiveErrors,
    staleLockSeconds,
    supervisorEnabled,
    supervisorIntervalMinutes,
    supervisorReviewKind,
    detach,
    detachLog,
    supervisor,
    json,
  }
}

const args = parseArgs(process.argv.slice(2))
const operationID = slug(args.operationID, "operation")

if (args.supervisor) {
  const result = await writeRuntimeSupervisor({
    operationID,
    worktree: process.cwd(),
    bunPath: process.execPath,
    scriptPath: fileURLToPath(import.meta.url),
    durationSeconds: args.durationSeconds,
    intervalSeconds: args.intervalSeconds,
    schedulerCyclesPerTick: args.schedulerCyclesPerTick,
    maxCycles: args.maxCycles,
    leaseSeconds: args.leaseSeconds,
    errorBackoffSeconds: args.errorBackoffSeconds,
    maxConsecutiveErrors: args.maxConsecutiveErrors,
    staleLockSeconds: args.staleLockSeconds,
    supervisor: args.supervisor,
  })
  console.log(args.json ? JSON.stringify(result, null, 2) : formatSupervisor(result))
  process.exit(0)
}

function formatSupervisor(result: Awaited<ReturnType<typeof writeRuntimeSupervisor>>) {
  return [
    `# Runtime Daemon Supervisor: ${result.operationID}`,
    "",
    `- supervisor: ${result.supervisor}`,
    `- manifest: ${result.files.manifest}`,
    `- runbook: ${result.files.runbook}`,
    result.files.launchdPlist ? `- launchd: ${result.files.launchdPlist}` : undefined,
    result.files.systemdService ? `- systemd: ${result.files.systemdService}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}

function childArgv(argv: string[]) {
  const result: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--detach") continue
    if (arg === "--detach-log") {
      index++
      continue
    }
    result.push(arg)
  }
  return result
}

if (args.detach) {
  const daemonDir = path.join(operationPath(process.cwd(), operationID), "scheduler")
  const logPath = path.resolve(args.detachLog ?? path.join(daemonDir, "daemon-process.log"))
  const launchPath = path.join(daemonDir, "daemon-launch.json")
  mkdirSync(path.dirname(logPath), { recursive: true })
  mkdirSync(daemonDir, { recursive: true })
  const logFD = openSync(logPath, "a")
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...childArgv(process.argv.slice(2))], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFD, logFD],
    env: process.env,
  })
  child.unref()
  closeSync(logFD)
  const launch = {
    operationID,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    logPath,
    heartbeatPath: path.join(daemonDir, "daemon-heartbeat.json"),
    schedulerLogPath: path.join(daemonDir, "daemon.jsonl"),
  }
  writeFileSync(launchPath, JSON.stringify(launch, null, 2) + "\n")
  console.log(args.json ? JSON.stringify({ ...launch, launchPath }, null, 2) : formatDetachedLaunch({ ...launch, launchPath }))
  process.exit(0)
}

function formatDetachedLaunch(launch: {
  operationID: string
  pid?: number
  startedAt: string
  logPath: string
  heartbeatPath: string
  schedulerLogPath: string
  launchPath: string
}) {
  return [
    `# Runtime Daemon Launched: ${launch.operationID}`,
    "",
    `- pid: ${launch.pid ?? "unknown"}`,
    `- started_at: ${launch.startedAt}`,
    `- launch: ${launch.launchPath}`,
    `- process_log: ${launch.logPath}`,
    `- heartbeat: ${launch.heartbeatPath}`,
    `- scheduler_log: ${launch.schedulerLogPath}`,
  ].join("\n")
}

const controller = new AbortController()
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort(signal))
}

try {
  const result = await runRuntimeDaemon(process.cwd(), {
    operationID: args.operationID,
    maxRuntimeSeconds: args.durationSeconds,
    cycleIntervalSeconds: args.intervalSeconds,
    maxCycles: args.maxCycles,
    schedulerCyclesPerTick: args.schedulerCyclesPerTick,
    leaseSeconds: args.leaseSeconds,
    errorBackoffSeconds: args.errorBackoffSeconds,
    maxConsecutiveErrors: args.maxConsecutiveErrors,
    staleLockSeconds: args.staleLockSeconds,
    supervisorEnabled: args.supervisorEnabled,
    supervisorIntervalMinutes: args.supervisorIntervalMinutes,
    supervisorReviewKind: args.supervisorReviewKind,
    signal: controller.signal,
  })
  console.log(args.json ? JSON.stringify(result, null, 2) : formatRuntimeDaemon(result))
  process.exit(result.stopped && result.reason !== "signal" ? 2 : 0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
