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

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
const MAX_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_CHECKPOINT_MINUTES = [5, 10, 15, 20, 25, 30]

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

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
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
      const requestedTimeout = params.timeout ?? defaultTimeout
      const timeout = Math.min(requestedTimeout, maxTimeout)
      const timeoutClamped = requestedTimeout !== timeout
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
        if (fullRangeNmap || aggressiveScripts || unboundedMasscan) {
          throw new Error(
            [
              "Scan safety policy blocked this command.",
              "Use progressive bounded scanning first (for example: nmap --top-ports 100 <target>).",
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
              command_preview: commandPreview(params.command),
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

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
          ...shellEnv.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: process.platform === "win32",
      })

      let output = ""
      const startedAt = Date.now()
      const commandPreviewText = commandPreview(params.command)

      // Initialize metadata with empty output
      const emitMetadata = (runtime?: Record<string, unknown>) =>
        ctx.metadata({
          metadata: {
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
            timeout_ms: timeout,
            timeout_max_ms: maxTimeout,
            timeout_requested_ms: requestedTimeout,
            timeout_clamped: timeoutClamped,
            command_preview: commandPreviewText,
            ...(runtime ? { bash_runtime: runtime } : {}),
            ...(risk.level === "sensitive"
              ? {
                  bash_risk: {
                    level: risk.level,
                    ...risk.match,
                  },
                }
              : {}),
          },
        })

      emitMetadata()

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        emitMetadata()
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const checkpointTimers = checkpointMinutes
        .map((minute) => ({
          minute,
          ms: minute * 60 * 1000,
        }))
        .filter((item) => item.ms <= timeout)
        .map((item) =>
          setTimeout(() => {
            const elapsedMs = Date.now() - startedAt
            const remainingMs = Math.max(timeout - elapsedMs, 0)
            emitMetadata({
              checkpoint_minute: item.minute,
              elapsed_ms: elapsedMs,
              remaining_ms: remainingMs,
              status: "running",
            })
          }, item.ms),
        )

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          for (const timer of checkpointTimers) clearTimeout(timer)
          ctx.abort.removeEventListener("abort", abortHandler)
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

      if (timeoutClamped) {
        resultMetadata.push(
          `bash tool clamped timeout from requested ${requestedTimeout} ms to enforced max ${timeout} ms`,
        )
      }

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      const elapsedMs = Date.now() - startedAt
      emitMetadata({
        elapsed_ms: elapsedMs,
        remaining_ms: Math.max(timeout - elapsedMs, 0),
        status: timedOut ? "timed_out" : aborted ? "aborted" : "completed",
      })

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          timeout: timeout,
          timeoutRequested: requestedTimeout,
          timeoutClamped,
          timeoutMax: maxTimeout,
          elapsedMs,
          description: params.description,
          commandPreview: commandPreviewText,
          ...(risk.level === "sensitive"
            ? {
                bash_risk: {
                  level: risk.level,
                  ...risk.match,
                },
              }
            : {}),
        },
        output,
      }
    },
  }
})
