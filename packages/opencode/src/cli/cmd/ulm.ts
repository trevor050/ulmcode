import type { Argv } from "yargs"
import { Effect } from "effect"
import { EOL } from "os"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { Instance } from "@/project/instance"
import {
  buildOperationResumeBrief,
  formatOperationResumeBrief,
  formatOperationStatusDashboard,
  listOperationStatuses,
  readOperationStatus,
  type OperationStatusSummary,
} from "@/ulm/artifact"

type Format = "table" | "dashboard" | "brief" | "json"

export const UlmCommand = cmd({
  command: "ulm",
  describe: "manage ULMCode operations",
  builder: (yargs: Argv) =>
    yargs.command(UlmListCommand).command(UlmStatusCommand).command(UlmResumeCommand).demandCommand(),
  async handler() {},
})

export const UlmListCommand = effectCmd({
  command: "list",
  describe: "list ULMCode operations",
  builder: (yargs) =>
    yargs
      .option("event-limit", {
        describe: "number of recent operation events to load",
        type: "number",
        default: 0,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: Effect.fn("Cli.ulm.list")(function* (args) {
    const statuses = yield* Effect.tryPromise(() =>
      listOperationStatuses(Instance.worktree, { eventLimit: args.eventLimit }),
    ).pipe(Effect.orDie)
    if (args.format === "json") {
      console.log(JSON.stringify(statuses, null, 2))
      return
    }
    const output = formatOperationListTable(statuses)
    if (output) console.log(output)
  }),
})

export const UlmStatusCommand = effectCmd({
  command: "status <operationID>",
  describe: "show a ULMCode operation dashboard",
  builder: (yargs) =>
    yargs
      .positional("operationID", {
        describe: "operation ID to inspect",
        type: "string",
        demandOption: true,
      })
      .option("event-limit", {
        describe: "number of recent operation events to load",
        type: "number",
        default: 5,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["dashboard", "json"],
        default: "dashboard",
      }),
  handler: Effect.fn("Cli.ulm.status")(function* (args) {
    const status = yield* Effect.tryPromise(() =>
      readOperationStatus(Instance.worktree, args.operationID, { eventLimit: args.eventLimit }),
    ).pipe(Effect.orDie)
    console.log(formatOperationStatusOutput(status, args.format))
  }),
})

export const UlmResumeCommand = effectCmd({
  command: "resume <operationID>",
  describe: "print a restart brief for a ULMCode operation",
  builder: (yargs) =>
    yargs
      .positional("operationID", {
        describe: "operation ID to resume",
        type: "string",
        demandOption: true,
      })
      .option("event-limit", {
        describe: "number of recent operation events to load",
        type: "number",
        default: 10,
      })
      .option("stale-after-minutes", {
        describe: "mark running checkpoints stale after this many minutes",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["brief", "json"],
        default: "brief",
      }),
  handler: Effect.fn("Cli.ulm.resume")(function* (args) {
    const brief = yield* Effect.tryPromise(() =>
      buildOperationResumeBrief(Instance.worktree, args.operationID, {
        eventLimit: args.eventLimit,
        staleAfterMinutes: args.staleAfterMinutes,
      }),
    ).pipe(Effect.orDie)
    console.log(args.format === "json" ? JSON.stringify(brief, null, 2) : formatOperationResumeBrief(brief))
  }),
})

export function formatOperationStatusOutput(status: OperationStatusSummary, format: Format) {
  if (format === "json") return JSON.stringify(status, null, 2)
  return formatOperationStatusDashboard(status)
}

export function formatOperationListTable(statuses: OperationStatusSummary[]) {
  if (!statuses.length) return ""
  const rows = statuses.map((status) => ({
    id: status.operationID,
    stage: status.operation?.stage ?? "unknown",
    status: status.operation?.status ?? "unknown",
    risk: status.operation?.riskLevel ?? "unknown",
    findings: String(status.findings.total),
    evidence: String(status.evidence.total),
    reports: [
      status.reports.html ? "html" : undefined,
      status.reports.pdf ? "pdf" : undefined,
      status.reports.manifest ? "manifest" : undefined,
      status.runtimeSummary ? "runtime" : undefined,
    ]
      .filter((item): item is string => !!item)
      .join(","),
    updated: status.operation?.time.updated ?? "",
  }))
  const columns = [
    ["Operation", "id"],
    ["Stage", "stage"],
    ["Status", "status"],
    ["Risk", "risk"],
    ["Findings", "findings"],
    ["Evidence", "evidence"],
    ["Reports", "reports"],
    ["Updated", "updated"],
  ] as const
  const widths = columns.map(([label, key]) => Math.max(label.length, ...rows.map((row) => row[key].length)))
  const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd()
  return [
    line(columns.map(([label]) => label)),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => line(columns.map(([, key]) => row[key]))),
  ].join(EOL)
}
