import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"
import fs from "fs/promises"

import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"
import { BashRisk } from "@/tool/bash-risk"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncate"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { BackgroundAgentManager } from "@/features/background-agent/manager"
import { CyberEnvironment } from "@/session/environment"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
const MAX_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_CHECKPOINT_MINUTES = [5, 10, 15, 20, 25, 30]
const DEFAULT_HEARTBEAT_MS = 15_000
const DEFAULT_INTERACTIVE_STALE_TIMEOUT_MS = 10 * 60 * 1000
const BASH_BACKGROUND_AGENT = "bash_command"

const ExecutionProfile = z.enum(["interactive", "long_run_background", "manual_unbounded"])
type ExecutionProfile = z.infer<typeof ExecutionProfile>

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

function commandPreview(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim()
  return normalized.length > 240 ? normalized.slice(0, 237) + "..." : normalized
}

function commandLooksLongRunning(command: string) {
  const normalized = command.toLowerCase()
  return [
    /\bnmap\b/,
    /\bmasscan\b/,
    /\bffuf\b/,
    /\bgobuster\b/,
    /\bferoxbuster\b/,
    /\bdirsearch\b/,
    /\bnikto\b/,
    /\bhydra\b/,
    /\bsqlmap\b/,
    /\bwfuzz\b/,
    /\bamass\b/,
    /\bsubfinder\b/,
    /\bhttpx\b/,
    /\bnaabu\b/,
    /\bassetfinder\b/,
    /\bwaybackurls\b/,
  ].some((pattern) => pattern.test(normalized))
}

function appendRuntimeMetadata(output: string, lines: string[]) {
  if (!lines.length) return output
  return output + "\n\n<bash_metadata>\n" + lines.join("\n") + "\n</bash_metadata>"
}

async function runShellCommand(input: {
  command: string
  cwd: string
  ctx: Tool.Context
  description: string
  timeout?: number
  maxTimeout?: number
  requestedTimeout?: number
  timeoutClamped?: boolean
  executionProfile: ExecutionProfile
  commandPreviewText: string
  checkpointMinutes: number[]
  risk: ReturnType<typeof BashRisk.classify>
  onProgress?: (update: {
    output: string
    elapsedMs: number
    status: "running" | "completed" | "timed_out" | "aborted"
  }) => void | Promise<void>
  staleTimeoutMs?: number
}) {
  const shellEnv = await Plugin.trigger(
    "shell.env",
    { cwd: input.cwd, sessionID: input.ctx.sessionID, callID: input.ctx.callID },
    { env: {} },
  )
  const proc = spawn(input.command, {
    shell: Shell.acceptable(),
    cwd: input.cwd,
    env: {
      ...process.env,
      ...shellEnv.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })

  let output = ""
  const startedAt = Date.now()
  const timeout = input.timeout
  const checkpointMinutes = input.checkpointMinutes
  const emitMetadata = (runtime?: Record<string, unknown>) =>
    input.ctx.metadata({
      metadata: {
        output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
        description: input.description,
        timeout_ms: timeout ?? null,
        timeout_max_ms: input.maxTimeout ?? null,
        timeout_requested_ms: input.requestedTimeout ?? null,
        timeout_clamped: input.timeoutClamped ?? false,
        execution_profile: input.executionProfile,
        command_preview: input.commandPreviewText,
        ...(runtime ? { bash_runtime: runtime } : {}),
        ...(input.risk.level === "sensitive"
          ? {
              bash_risk: {
                level: input.risk.level,
                ...input.risk.match,
              },
            }
          : {}),
      },
    })

  emitMetadata()

  let lastProgressAt = startedAt
  let timedOut = false
  let aborted = false
  let exited = false
  const kill = () => Shell.killTree(proc, { exited: () => exited })
  const flushProgress = async (status: "running" | "completed" | "timed_out" | "aborted") => {
    const elapsedMs = Date.now() - startedAt
    await input.onProgress?.({
      output,
      elapsedMs,
      status,
    })
  }
  const markProgress = () => {
    lastProgressAt = Date.now()
    void flushProgress("running")
  }
  const append = (chunk: Buffer) => {
    output += chunk.toString()
    markProgress()
    emitMetadata({
      elapsed_ms: Date.now() - startedAt,
      status: "running",
    })
  }

  proc.stdout?.on("data", append)
  proc.stderr?.on("data", append)

  if (input.ctx.abort.aborted) {
    aborted = true
    await kill()
  }

  const abortHandler = () => {
    aborted = true
    void kill()
  }

  input.ctx.abort.addEventListener("abort", abortHandler, { once: true })

  const checkpointTimers = checkpointMinutes
    .map((minute) => ({
      minute,
      ms: minute * 60 * 1000,
    }))
    .filter((item) => (timeout ? item.ms <= timeout : true))
    .map((item) =>
      setTimeout(() => {
        const elapsedMs = Date.now() - startedAt
        const remainingMs = timeout ? Math.max(timeout - elapsedMs, 0) : null
        emitMetadata({
          checkpoint_minute: item.minute,
          elapsed_ms: elapsedMs,
          remaining_ms: remainingMs,
          status: "running",
        })
        void flushProgress("running")
      }, item.ms),
    )

  const heartbeatTimer = setInterval(() => {
    const elapsedMs = Date.now() - startedAt
    const remainingMs = timeout ? Math.max(timeout - elapsedMs, 0) : null
    emitMetadata({
      elapsed_ms: elapsedMs,
      remaining_ms: remainingMs,
      status: "running",
      heartbeat_ms: DEFAULT_HEARTBEAT_MS,
      last_progress_ms: Date.now() - lastProgressAt,
    })
    void flushProgress("running")
  }, DEFAULT_HEARTBEAT_MS)

  const staleTimer =
    !timeout && input.staleTimeoutMs
      ? setInterval(() => {
          if (Date.now() - lastProgressAt <= input.staleTimeoutMs!) return
          timedOut = true
          void kill()
        }, Math.min(DEFAULT_HEARTBEAT_MS, Math.max(5_000, Math.floor(input.staleTimeoutMs / 4))))
      : undefined

  const timeoutTimer =
    timeout !== undefined
      ? setTimeout(() => {
          timedOut = true
          void kill()
        }, timeout + 100)
      : undefined

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (staleTimer) clearInterval(staleTimer)
      clearInterval(heartbeatTimer)
      for (const timer of checkpointTimers) clearTimeout(timer)
      input.ctx.abort.removeEventListener("abort", abortHandler)
    }

    proc.once("exit", () => {
      exited = true
      cleanup()
      resolve()
    })

    proc.once("error", (error) => {
      exited = true
      cleanup()
      reject(error)
    })
  })

  const resultMetadata: string[] = []
  if (input.timeoutClamped && timeout !== undefined && input.requestedTimeout !== undefined) {
    resultMetadata.push(`bash tool clamped timeout from requested ${input.requestedTimeout} ms to enforced max ${timeout} ms`)
  }
  if (timedOut) {
    if (timeout !== undefined) resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
    else resultMetadata.push(`bash tool terminated command after stale/no-progress timeout ${input.staleTimeoutMs ?? DEFAULT_INTERACTIVE_STALE_TIMEOUT_MS} ms`)
  }
  if (aborted) {
    resultMetadata.push("User aborted the command")
  }
  output = appendRuntimeMetadata(output, resultMetadata)

  const elapsedMs = Date.now() - startedAt
  const finalStatus = timedOut ? "timed_out" : aborted ? "aborted" : "completed"
  emitMetadata({
    elapsed_ms: elapsedMs,
    remaining_ms: timeout ? Math.max(timeout - elapsedMs, 0) : null,
    status: finalStatus,
  })
  await flushProgress(finalStatus)

  return {
    output,
    elapsedMs,
    exitCode: proc.exitCode,
    timedOut,
    aborted,
  }
}

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      execution_profile: ExecutionProfile.optional().describe(
        "Execution mode: interactive for fast commands, long_run_background for scans/enumeration that should continue asynchronously, manual_unbounded for explicit no-hard-timeout runs with heartbeat monitoring.",
      ),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const cfg = await Config.get()
      const defaultTimeout =
        cfg.cyber?.command_timeout_default_ms ?? Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS
      const maxTimeout = cfg.cyber?.command_timeout_max_ms ?? Flag.OPENCODE_EXPERIMENTAL_BASH_MAX_TIMEOUT_MS ?? MAX_TIMEOUT_MS
      const inferredProfile: ExecutionProfile =
        params.execution_profile ??
        (CyberEnvironment.isCyberAgent(ctx.agent) && commandLooksLongRunning(params.command)
          ? "long_run_background"
          : "interactive")
      const checkpointMinutes = Array.from(
        new Set(
          (
            cfg.cyber?.command_checkpoint_minutes ??
            Flag.OPENCODE_EXPERIMENTAL_BASH_CHECKPOINT_MINUTES ??
            DEFAULT_CHECKPOINT_MINUTES
          )
            .filter((item) => Number.isInteger(item) && item > 0)
            .sort((a, b) => a - b),
        ),
      )
      if (cfg.cyber?.enforce_scan_safety_defaults || Flag.OPENCODE_EXPERIMENTAL_ENFORCE_SCAN_SAFETY_DEFAULTS) {
        const cmd = params.command.toLowerCase()
        const fullRangeNmap = /\bnmap\b/.test(cmd) && /\s-p-\b/.test(cmd)
        const aggressiveScripts = /\bnmap\b/.test(cmd) && /--script\s*=\s*vuln/.test(cmd)
        const unboundedMasscan = /\bmasscan\b/.test(cmd) && !/--rate=\d+/.test(cmd)
        const canBypassByProfile = inferredProfile !== "interactive"
        if ((fullRangeNmap || aggressiveScripts || unboundedMasscan) && !canBypassByProfile) {
          throw new Error(
            [
              "Scan safety policy blocked this command.",
              "Use progressive bounded scanning first (for example: nmap --top-ports 100 <target>).",
              "If you intentionally need a deeper authorized run, retry with execution_profile=long_run_background or execution_profile=manual_unbounded.",
              "Escalate to deep/full-range scans only after reviewing scoped results and authorization.",
            ].join(" "),
          )
        }
      }
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue

        // Get full command text including redirects if present
        let commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = await fs.realpath(path.resolve(cwd, arg)).catch(() => "")
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              const normalized =
                process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
              if (!Instance.containsPath(normalized)) {
                const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
                directories.add(dir)
              }
            }
          }
        }

        // cd covered by above check
        if (command.length && command[0] !== "cd") {
          patterns.add(commandText)
          always.add(BashArity.prefix(command).join(" ") + " *")
        }
      }

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => {
          // Preserve POSIX-looking paths with /s, even on Windows
          if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
          return path.join(dir, "*")
        })
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      const risk = BashRisk.classify(params.command)
      const commandPreviewText = commandPreview(params.command)

      if (patterns.size > 0) {
        if (risk.level === "sensitive") {
          const approvalPatterns = Array.from(patterns)
          await ctx.ask({
            permission: "bash_sensitive",
            patterns: approvalPatterns,
            always: Array.from(always.size > 0 ? always : new Set(approvalPatterns)),
            metadata: {
              reason: risk.match.reason,
              matched_rule: risk.match.matched_rule,
              command_preview: commandPreviewText,
              engagement_context: {
                session_id: ctx.sessionID,
                agent: ctx.agent,
                cwd,
              },
            },
          })
        }
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }
      const requestedTimeout = params.timeout ?? defaultTimeout
      const interactiveTimeout = Math.min(requestedTimeout, maxTimeout)
      const timeoutClamped = requestedTimeout !== interactiveTimeout

      if (inferredProfile === "long_run_background") {
        let backgroundTaskId = ""
        const task = await BackgroundAgentManager.start({
          description: params.description,
          prompt: params.command,
          subagentType: BASH_BACKGROUND_AGENT,
          parentSessionID: ctx.sessionID,
          sessionID: ctx.sessionID,
          run: async ({ signal, touch }) => {
            const result = await runShellCommand({
              command: params.command,
              cwd,
              ctx: {
                ...ctx,
                abort: signal,
              },
              description: params.description,
              executionProfile: inferredProfile,
              commandPreviewText,
              checkpointMinutes,
              risk,
              staleTimeoutMs: cfg.cyber?.background_task?.stale_timeout_ms ?? DEFAULT_INTERACTIVE_STALE_TIMEOUT_MS,
              onProgress: async (update) => {
                touch()
                if (!backgroundTaskId) return
                await BackgroundAgentManager.update(backgroundTaskId, {
                  output:
                    update.output.length > MAX_METADATA_LENGTH
                      ? update.output.slice(0, MAX_METADATA_LENGTH) + "\n\n..."
                      : update.output,
                })
              },
            })
            return { output: result.output }
          },
          cancel: () => {},
        })
        backgroundTaskId = task.id
        return {
          title: params.description,
          metadata: {
            output: "",
            exit: null,
            timeout: null,
            timeoutRequested: params.timeout ?? null,
            timeoutClamped: false,
            timeoutMax: null,
            elapsedMs: 0,
            description: params.description,
            commandPreview: commandPreviewText,
            executionProfile: inferredProfile,
            backgroundTaskId: task.id,
            backgroundStatus: task.status,
            ...(risk.level === "sensitive"
              ? {
                  bash_risk: {
                    level: risk.level,
                    ...risk.match,
                  },
                }
              : {}),
          },
          output: [
            `background_task_id: ${task.id}`,
            `execution_profile: ${inferredProfile}`,
            `command_preview: ${commandPreviewText}`,
            "",
            "Long-running command queued in the background.",
            "Use background_list to monitor it, background_output to inspect live or final output, and background_cancel to stop it.",
          ].join("\n"),
        }
      }

      const result = await runShellCommand({
        command: params.command,
        cwd,
        ctx,
        description: params.description,
        timeout: inferredProfile === "manual_unbounded" ? undefined : interactiveTimeout,
        maxTimeout: inferredProfile === "manual_unbounded" ? undefined : maxTimeout,
        requestedTimeout: inferredProfile === "manual_unbounded" ? undefined : requestedTimeout,
        timeoutClamped: inferredProfile === "manual_unbounded" ? false : timeoutClamped,
        executionProfile: inferredProfile,
        commandPreviewText,
        checkpointMinutes,
        risk,
        staleTimeoutMs: inferredProfile === "manual_unbounded" ? DEFAULT_INTERACTIVE_STALE_TIMEOUT_MS : undefined,
      })

      return {
        title: params.description,
        metadata: {
          output:
            result.output.length > MAX_METADATA_LENGTH
              ? result.output.slice(0, MAX_METADATA_LENGTH) + "\n\n..."
              : result.output,
          exit: result.exitCode,
          timeout: inferredProfile === "manual_unbounded" ? null : interactiveTimeout,
          timeoutRequested: inferredProfile === "manual_unbounded" ? null : requestedTimeout,
          timeoutClamped: inferredProfile === "manual_unbounded" ? false : timeoutClamped,
          timeoutMax: inferredProfile === "manual_unbounded" ? null : maxTimeout,
          elapsedMs: result.elapsedMs,
          description: params.description,
          commandPreview: commandPreviewText,
          executionProfile: inferredProfile,
          ...(risk.level === "sensitive"
            ? {
                bash_risk: {
                  level: risk.level,
                  ...risk.match,
                },
              }
            : {}),
        },
        output: result.output,
      }
    },
  }
})
