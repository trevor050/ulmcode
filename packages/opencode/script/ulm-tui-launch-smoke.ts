#!/usr/bin/env bun

import path from "path"
import { fileURLToPath } from "url"
import { spawn } from "../src/pty/pty.bun"

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const timeoutMs = Number.parseInt(Bun.argv.find((arg) => arg.startsWith("--timeout-ms="))?.split("=")[1] ?? "15000", 10)
const fatalPatterns = [
  /fatal error occurred/i,
  /undefined is not an object/i,
  /overlay\.r/i,
  /evaluating ['"]overlay\.r['"]/i,
]

function stripAnsi(input: string) {
  return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "")
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

let output = ""
let settled = false
let fatal: string | undefined

const proc = spawn("bun", ["run", "--conditions=browser", "./src/index.ts"], {
  name: "xterm-256color",
  cols: 160,
  rows: 48,
  cwd: packageRoot,
  env: {
    ...Bun.env,
    CI: "1",
    NO_COLOR: "1",
    OMO_DISABLE_POSTHOG: "1",
    OPENCODE_DISABLE_AUTO_UPDATE: "1",
    TERM: "xterm-256color",
  },
})

const data = proc.onData((chunk) => {
  output += chunk
  for (const pattern of fatalPatterns) {
    if (pattern.test(stripAnsi(output))) fatal = pattern.source
  }
})

const exit = proc.onExit((event) => {
  if (!settled) {
    settled = true
    fatal = fatal ?? `process exited before launch smoke completed: ${JSON.stringify(event)}`
  }
})

await Bun.sleep(timeoutMs)
settled = true

data.dispose()
exit.dispose()
proc.write("\u0003")
proc.kill("SIGTERM")

const plain = stripAnsi(output)
assert(!fatal, `TUI launch smoke saw a fatal launch condition (${fatal}).\n\n${plain.slice(-4000)}`)
assert(plain.length > 0, "TUI launch smoke produced no terminal output")
assert(
  /Sisyphus|OpenCode|OpenAI|GPT|model|tokens|message/i.test(plain),
  `TUI launch smoke did not observe recognizable prompt UI output.\n\n${plain.slice(-4000)}`,
)

console.log("ulm_tui_launch_smoke: ok")
