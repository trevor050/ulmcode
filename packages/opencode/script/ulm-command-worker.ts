#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

type CommandPlanFile = {
  command: string
  operationRoot: string
  stdoutPath: string
  stderrPath: string
  heartbeatPath: string
  supervision: {
    heartbeatSeconds: number
    idleTimeoutSeconds: number
    hardTimeoutSeconds: number
  }
}

const planPath = process.argv[2]
if (!planPath) {
  console.error("Usage: bun run script/ulm-command-worker.ts <command-plan.json>")
  process.exit(1)
}

const plan = JSON.parse(await fs.readFile(planPath, "utf8")) as CommandPlanFile

async function writeHeartbeat(input: {
  status: "running" | "completed" | "error"
  lastOutputAt: number
  timedOut?: "hard" | "idle"
  exitCode?: number
  error?: string
}) {
  await fs.mkdir(path.dirname(plan.heartbeatPath), { recursive: true })
  await fs.writeFile(
    plan.heartbeatPath,
    JSON.stringify(
      {
        status: input.status,
        command: plan.command,
        planPath,
        checkedAt: new Date().toISOString(),
        lastOutputAt: new Date(input.lastOutputAt).toISOString(),
        idleSeconds: Math.round((Date.now() - input.lastOutputAt) / 1000),
        timedOut: input.timedOut,
        exitCode: input.exitCode,
        error: input.error,
      },
      null,
      2,
    ) + "\n",
  )
}

async function drain(stream: ReadableStream<Uint8Array> | null, file: string, onOutput: () => void) {
  if (!stream) return ""
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let text = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    const part = decoder.decode(chunk.value, { stream: true })
    text += part
    onOutput()
    await fs.appendFile(file, part)
  }
  const tail = decoder.decode()
  if (tail) {
    text += tail
    onOutput()
    await fs.appendFile(file, tail)
  }
  return text
}

await fs.mkdir(path.dirname(plan.stdoutPath), { recursive: true })
await fs.writeFile(plan.stdoutPath, "")
await fs.writeFile(plan.stderrPath, "")

let lastOutputAt = Date.now()
let timedOut: "hard" | "idle" | undefined
await writeHeartbeat({ status: "running", lastOutputAt })

const proc = Bun.spawn(["bash", "-lc", plan.command], {
  cwd: plan.operationRoot,
  stdout: "pipe",
  stderr: "pipe",
})

const hardTimeout = setTimeout(() => {
  timedOut = "hard"
  proc.kill("SIGTERM")
  setTimeout(() => proc.kill("SIGKILL"), 5_000).unref()
}, plan.supervision.hardTimeoutSeconds * 1000)
hardTimeout.unref()

const heartbeat = setInterval(() => {
  if (!timedOut && Date.now() - lastOutputAt > plan.supervision.idleTimeoutSeconds * 1000) {
    timedOut = "idle"
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 5_000).unref()
  }
  void writeHeartbeat({ status: "running", lastOutputAt, timedOut })
}, plan.supervision.heartbeatSeconds * 1000)
heartbeat.unref()

try {
  const [, stderrText, exitCode] = await Promise.all([
    drain(proc.stdout, plan.stdoutPath, () => {
      lastOutputAt = Date.now()
    }),
    drain(proc.stderr, plan.stderrPath, () => {
      lastOutputAt = Date.now()
    }),
    proc.exited,
  ])
  clearTimeout(hardTimeout)
  clearInterval(heartbeat)
  const status = exitCode === 0 && !timedOut ? "completed" : "error"
  await writeHeartbeat({
    status,
    lastOutputAt,
    timedOut,
    exitCode,
    error: timedOut ? `command ${timedOut} timeout` : exitCode === 0 ? undefined : stderrText.slice(0, 2000),
  })
  process.exit(status === "completed" ? 0 : 1)
} catch (error) {
  clearTimeout(hardTimeout)
  clearInterval(heartbeat)
  await writeHeartbeat({
    status: "error",
    lastOutputAt,
    timedOut,
    error: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
}
