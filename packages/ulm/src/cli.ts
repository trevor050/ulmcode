#!/usr/bin/env bun
import path from "node:path"
import { parseArgs } from "node:util"
import { artifactsInput, createHost, createInput, localLabPlan, planInput, renderFinal, startServer } from "./server"
import { recordFindingsInputSchema } from "./findings"
import { startFakeLab } from "./fake-lab"
import { resolveProfilePaths } from "./profile"
import { OperationScheduler } from "./scheduler"
import { mkdir, writeFile } from "node:fs/promises"

const parsed = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    workspace: { type: "string" },
    port: { type: "string" },
    chromium: { type: "string" },
    "profile-root": { type: "string" },
    "command-catalog": { type: "string" },
    "allowed-origin": { type: "string", multiple: true },
    detach: { type: "boolean" },
    resume: { type: "boolean" },
    id: { type: "string" },
    session: { type: "string" },
    objective: { type: "string" },
    target: { type: "string" },
    input: { type: "string" },
    operator: { type: "string" },
    reason: { type: "string" },
    verdict: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
})

const command = parsed.positionals[0]
const id = parsed.values.id ?? parsed.positionals[1]
const workspaceRoot = path.resolve(parsed.values.workspace ?? path.resolve(import.meta.dir, "../../.."))
const chromiumPath = parsed.values.chromium ?? process.env.ULMCODE_CHROMIUM
const profileRoot = parsed.values["profile-root"] ?? process.env.ULMCODE_PROFILE_ROOT
const credentialsDir = profileRoot ? path.join(resolveProfilePaths({ root: profileRoot }).privateDir, "credentials") : undefined
const commandCatalogPath = parsed.values["command-catalog"] ?? process.env.ULMCODE_COMMAND_CATALOG
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))

if (!command || parsed.values.help) {
  console.log(`ULMCode local operations on official OpenCode 2

Usage: bun packages/ulm/src/cli.ts <command> [operation-id] [options]

Commands: serve, fake-lab, create, list, status, plan, approve, run, daemon, interrupt,
          recover, artifacts, normalize, findings, review-goal, report, events

Options:
  --workspace <path>   Explicit operation workspace (default: this source worktree)
  --id <id>            Exact operation ID; no implicit latest operation
  --input <json-file>  Validated create input, including explicit session and scope
  --session <id>      Chat binding for create (default: console:<operation-id>)
  --objective <text>  Objective for local synthetic lab create
  --target <url>      Synthetic loopback lab (default: http://127.0.0.1:4320)
  --operator <name>   Plan approver (required by approve)
  --verdict <value>   continue, done, needs_operator
  --port <number>     serve default 4310; fake-lab default 4320
  --chromium <path>   Real Chromium executable for PDF rendering
  --profile-root <p>  Explicit isolated profile root to enable private vault
  --command-catalog <p> Explicit trusted non-destructive command catalog
  --allowed-origin <o> Exact renderer origin for serve; repeat for multiple origins
  --detach           Launch daemon in the background and verify its heartbeat
  --resume           Recover a scheduler shutdown; operator stops require recover

Local synthetic execution only. Upstream chat: tools/ulmcode/launch.ts.`)
  process.exit(0)
}

if (command === "serve" || command === "fake-lab") {
  const port = parsed.values.port ? Number(parsed.values.port) : undefined
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error("port must be an integer from 0 to 65535")
  if (command === "fake-lab") {
    const server = startFakeLab({ port })
    print({ service: "ulmcode-synthetic-lab", url: server.url.href, synthetic: true })
    process.on("SIGTERM", () => server.stop(true))
    process.on("SIGINT", () => server.stop(true))
  } else {
    const allowedOrigins = parsed.values["allowed-origin"] ?? process.env.ULMCODE_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean)
    const host = startServer({ workspaceRoot, port, chromiumPath, credentialsDir, commandCatalogPath, allowedOrigins })
    print({ service: "ulmcode-operations", url: host.server.url.href, workspaceRoot })
    process.on("SIGTERM", () => void host.close())
    process.on("SIGINT", () => void host.close())
  }
} else {
  const host = createHost({ workspaceRoot, chromiumPath, credentialsDir, commandCatalogPath })
  try {
    if (command === "list") print({ operations: await host.store.list() })
    else if (command === "create") {
      if (!id && !parsed.values.input) throw new Error("create requires --id or --input")
      const input = createInput.parse(parsed.values.input ? await Bun.file(parsed.values.input).json() : {
        id,
        sessionID: parsed.values.session ?? `console:${id}`,
        objective: parsed.values.objective ?? "Validate authorized synthetic local lab evidence and final report workflow",
        scope: { targets: [parsed.values.target ?? "http://127.0.0.1:4320"], mode: "synthetic_lab" },
        plan: localLabPlan(),
      })
      print({ operation: await host.engine.create({ ...input, plan: input.plan ?? localLabPlan() }) })
    } else {
      if (!id) throw new Error(`${command} requires an exact operation ID`)
      const operation = await host.store.get(id)
      if (!operation) throw new Error("operation not found")
      if (command === "status") print({ operation })
      else if (command === "events") print({ events: await host.store.events(id) })
      else if (command === "daemon") {
        const directory = path.join(host.store.directory(id), "runtime")
        if (parsed.values.detach) {
          await mkdir(directory, { recursive: true, mode: 0o700 })
          const log = path.join(directory, "daemon.stdout.json")
          const errorLog = path.join(directory, "daemon.stderr.log")
          await writeFile(log, "", { flag: "a", mode: 0o600 })
          await writeFile(errorLog, "", { flag: "a", mode: 0o600 })
          const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2).filter((argument) => argument !== "--detach")], {
            cwd: process.cwd(), env: process.env, detached: true, stdin: "ignore", stdout: Bun.file(log), stderr: Bun.file(errorLog),
          })
          child.unref()
          const deadline = Date.now() + 10_000
          let heartbeat: { pid?: number; status?: string } | undefined
          while (Date.now() < deadline) {
            heartbeat = await Bun.file(path.join(directory, "scheduler.json")).json().catch(() => undefined)
            if (heartbeat?.pid === child.pid) break
            if (child.exitCode !== null) break
            await Bun.sleep(25)
          }
          if (heartbeat?.pid !== child.pid) throw new Error(`daemon did not establish its heartbeat; inspect ${errorLog}`)
          print({ operationID: id, pid: child.pid, status: heartbeat.status, heartbeat: path.join(directory, "scheduler.json"), log })
        } else {
          const controller = new AbortController()
          const stop = () => controller.abort()
          process.once("SIGTERM", stop)
          process.once("SIGINT", stop)
          try {
            const scheduler = new OperationScheduler({ engine: host.engine, store: host.store, report: () => renderFinal(host, id) })
            const result = await scheduler.run(id, { signal: controller.signal, resume: parsed.values.resume })
            print({ scheduler: result })
            process.exitCode = result.action === "complete" ? 0 : result.action === "interrupted" ? 130 : 2
          } finally {
            process.off("SIGTERM", stop)
            process.off("SIGINT", stop)
          }
        }
      }
      else if (command === "plan") {
        if (!parsed.values.input) throw new Error("plan requires --input pointing to a full plan JSON file")
        print({ operation: await host.engine.setPlan(id, planInput.parse(await Bun.file(parsed.values.input).json())) })
      }
      else if (command === "approve") {
        if (!parsed.values.operator) throw new Error("approve requires --operator")
        print({ operation: await host.engine.approvePlan(id, { approvedBy: parsed.values.operator }) })
      } else if (command === "run") print({ decision: await host.engine.tick(id) })
      else if (command === "interrupt") print({ operation: await host.engine.interrupt(id, parsed.values.reason ?? "Operator interrupted") })
      else if (command === "recover") print({ recovery: await host.engine.recover(id) })
      else if (command === "normalize") print({ operation: await host.engine.normalizeEvidence(id) })
      else if (command === "artifacts") {
        if (!parsed.values.input) throw new Error("artifacts requires --input with operation-relative artifact paths")
        print({ operation: await host.engine.recordArtifacts(id, artifactsInput.parse(await Bun.file(parsed.values.input).json()).artifacts) })
      }
      else if (command === "findings") {
        if (!parsed.values.input) throw new Error("findings requires --input with the canonical finding collection and review metadata")
        print({ operation: await host.engine.recordFindings(id, recordFindingsInputSchema.parse(await Bun.file(parsed.values.input).json())) })
      }
      else if (command === "report") print(await renderFinal(host, id))
      else if (command === "review-goal") {
        const verdict = parsed.values.verdict
        if (verdict !== "continue" && verdict !== "done" && verdict !== "needs_operator") throw new Error("verdict must be continue, done, or needs_operator")
        print({ result: await host.engine.reviewGoal(id, verdict, { reason: parsed.values.reason }) })
      } else throw new Error(`unknown command: ${command}`)
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : "Command failed" }))
    process.exitCode = 1
  } finally {
    await host.store.close()
  }
}
