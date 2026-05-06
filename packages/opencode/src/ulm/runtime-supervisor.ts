import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"

export type RuntimeSupervisorKind = "launchd" | "systemd" | "all"

export type RuntimeSupervisorInput = {
  operationID: string
  worktree: string
  bunPath: string
  scriptPath: string
  durationSeconds: number
  intervalSeconds: number
  schedulerCyclesPerTick: number
  maxCycles?: number
  leaseSeconds?: number
  errorBackoffSeconds?: number
  maxConsecutiveErrors?: number
  staleLockSeconds?: number
  supervisor: RuntimeSupervisorKind
}

export type RuntimeSupervisorResult = {
  operationID: string
  generatedAt: string
  supervisor: RuntimeSupervisorKind
  serviceName: string
  label: string
  command: string[]
  files: {
    manifest: string
    runbook: string
    launchdPlist?: string
    systemdService?: string
  }
}

function plistEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function systemdQuote(value: string) {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function daemonArgs(input: RuntimeSupervisorInput) {
  const args = [
    input.scriptPath,
    input.operationID,
    "--duration-seconds",
    String(input.durationSeconds),
    "--interval-seconds",
    String(input.intervalSeconds),
    "--scheduler-cycles",
    String(input.schedulerCyclesPerTick),
    "--json",
  ]
  if (input.maxCycles !== undefined) args.push("--max-cycles", String(input.maxCycles))
  if (input.leaseSeconds !== undefined) args.push("--lease-seconds", String(input.leaseSeconds))
  if (input.errorBackoffSeconds !== undefined) args.push("--error-backoff-seconds", String(input.errorBackoffSeconds))
  if (input.maxConsecutiveErrors !== undefined) args.push("--max-consecutive-errors", String(input.maxConsecutiveErrors))
  if (input.staleLockSeconds !== undefined) args.push("--stale-lock-seconds", String(input.staleLockSeconds))
  return args
}

function launchdPlist(input: {
  label: string
  command: string[]
  worktree: string
  stdoutPath: string
  stderrPath: string
}) {
  const programArguments = input.command.map((arg) => `    <string>${plistEscape(arg)}</string>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistEscape(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>WorkingDirectory</key>
  <string>${plistEscape(input.worktree)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${plistEscape(input.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${plistEscape(input.stderrPath)}</string>
</dict>
</plist>
`
}

function systemdService(input: {
  serviceName: string
  command: string[]
  worktree: string
  stdoutPath: string
  stderrPath: string
}) {
  return `[Unit]
Description=ULMCode runtime daemon for ${input.serviceName}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${input.worktree}
ExecStart=${input.command.map(systemdQuote).join(" ")}
Restart=on-failure
RestartSec=30
StandardOutput=append:${input.stdoutPath}
StandardError=append:${input.stderrPath}

[Install]
WantedBy=default.target
`
}

function runbook(input: RuntimeSupervisorResult) {
  return [
    `# Runtime Daemon Supervisor Install: ${input.operationID}`,
    "",
    "These files run the foreground ULM runtime daemon under the OS service manager. Do not add `--detach`; launchd/systemd own the process and restart policy.",
    "",
    "## launchd",
    "",
    input.files.launchdPlist
      ? [
          "```sh",
          `mkdir -p ~/Library/LaunchAgents`,
          `cp ${input.files.launchdPlist} ~/Library/LaunchAgents/${path.basename(input.files.launchdPlist)}`,
          `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${path.basename(input.files.launchdPlist)}`,
          `launchctl kickstart -k gui/$(id -u)/${input.label}`,
          "```",
        ].join("\n")
      : "Not generated for this supervisor mode.",
    "",
    "## systemd user service",
    "",
    input.files.systemdService
      ? [
          "```sh",
          `mkdir -p ~/.config/systemd/user`,
          `cp ${input.files.systemdService} ~/.config/systemd/user/${path.basename(input.files.systemdService)}`,
          `systemctl --user daemon-reload`,
          `systemctl --user enable --now ${path.basename(input.files.systemdService)}`,
          "```",
        ].join("\n")
      : "Not generated for this supervisor mode.",
    "",
    "## Evidence",
    "",
    `- manifest: ${input.files.manifest}`,
    `- runbook: ${input.files.runbook}`,
    `- command: ${input.command.join(" ")}`,
    "",
  ].join("\n")
}

export async function writeRuntimeSupervisor(input: RuntimeSupervisorInput): Promise<RuntimeSupervisorResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(input.worktree, operationID)
  const supervisorDir = path.join(root, "scheduler", "supervisor")
  const logDir = path.join(root, "scheduler")
  const serviceName = `ulmcode-runtime-daemon-${operationID}`
  const label = `com.ulmcode.runtime-daemon.${operationID}`
  const stdoutPath = path.join(logDir, "daemon-supervisor.stdout.log")
  const stderrPath = path.join(logDir, "daemon-supervisor.stderr.log")
  const command = [input.bunPath, "run", ...daemonArgs({ ...input, operationID })]
  const files: RuntimeSupervisorResult["files"] = {
    manifest: path.join(supervisorDir, "supervisor-manifest.json"),
    runbook: path.join(supervisorDir, "supervisor-install.md"),
  }
  if (input.supervisor === "launchd" || input.supervisor === "all") {
    files.launchdPlist = path.join(supervisorDir, `${label}.plist`)
  }
  if (input.supervisor === "systemd" || input.supervisor === "all") {
    files.systemdService = path.join(supervisorDir, `${serviceName}.service`)
  }
  const result: RuntimeSupervisorResult = {
    operationID,
    generatedAt: new Date().toISOString(),
    supervisor: input.supervisor,
    serviceName,
    label,
    command,
    files,
  }

  await fs.mkdir(supervisorDir, { recursive: true })
  if (files.launchdPlist) {
    await fs.writeFile(files.launchdPlist, launchdPlist({ label, command, worktree: input.worktree, stdoutPath, stderrPath }))
  }
  if (files.systemdService) {
    await fs.writeFile(files.systemdService, systemdService({ serviceName, command, worktree: input.worktree, stdoutPath, stderrPath }))
  }
  await fs.writeFile(files.runbook, runbook(result))
  await fs.writeFile(files.manifest, JSON.stringify(result, null, 2) + "\n")
  return result
}
