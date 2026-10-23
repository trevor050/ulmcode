import { mkdir, readdir } from "node:fs/promises"
import { checkoutRoot, evidenceRoot } from "./paths"

const run = `${evidenceRoot}/worker-death-${new Date().toISOString().replace(/[:.]/g, "-")}`
const workspace = `${run}/workspace`
const operationRoot = `${workspace}/.ulmcode/operations/worker-death`
const supervisionRoot = `${workspace}/.ulmcode/supervision/worker-death`
const marker = `${run}/dispatch.marker`
const catalog = `${run}/catalog.json`
const timeoutMs = 2500
const results: { name: string; passed: boolean; detail?: unknown }[] = []
const children = new Map<number, string>()
await mkdir(`${workspace}/.ulmcode/operations`, { recursive: true })
await Bun.write(
  catalog,
  JSON.stringify({
    schemaVersion: 1,
    profiles: [
      {
        profileID: "worker-death",
        safety: "non_destructive",
        scopes: ["synthetic_lab"],
        executable: process.execPath,
        args: [new URL("./command-fixture.ts", import.meta.url).pathname, "watchdog", marker, "http://127.0.0.1:9"],
        variables: {},
        targetPolicy: "loopback",
        timeoutMs,
        maxOutputBytes: 4096,
        restart: "safe",
      },
    ],
  }),
)
await Bun.write(
  `${run}/input.json`,
  JSON.stringify({
    id: "worker-death",
    sessionID: "session-worker-death",
    objective: "Prove an independent child deadline survives worker death",
    scope: { targets: ["http://127.0.0.1:9"], mode: "synthetic_lab" },
    plan: {
      version: 1,
      assumptions: ["Synthetic local process only"],
      successCriteria: ["Independent deadline kills the process tree"],
      phases: [
        {
          id: "command",
          title: "Synthetic watchdog fixture",
          dependsOn: [],
          successCriteria: ["Bound actual process lifetime"],
          restart: "safe",
          expectedArtifacts: [],
          command: { profileID: "worker-death", variables: {} },
        },
      ],
      reporting: { required: true },
    },
  }),
)
async function cli(args: string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      `${checkoutRoot}/packages/ulm/src/cli.ts`,
      ...args,
      "--workspace",
      workspace,
      "--command-catalog",
      catalog,
    ],
    { cwd: checkoutRoot, stdout: "pipe", stderr: "pipe", timeout: 15000 },
  )
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  await Bun.write(`${run}/cli-${args[0]}.json`, JSON.stringify({ exit, stdout, stderr }))
  return { exit, body: stdout ? JSON.parse(stdout) : undefined }
}
async function check(name: string, passed: boolean, detail?: unknown) {
  results.push({ name, passed, detail })
  await Bun.write(`${run}/results.json`, JSON.stringify({ run, timeoutMs, results }, null, 2) + "\n")
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`)
  if (!passed) throw new Error(name)
}
async function running(pid: number) {
  const stat = await Bun.file(`/proc/${pid}/stat`)
    .text()
    .catch(() => "")
  const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0]
  return Boolean(stat) && state !== "Z" && state !== "X"
}
async function identity(pid: number) {
  const stat = await Bun.file(`/proc/${pid}/stat`)
    .text()
    .catch(() => "")
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? ""
}
try {
  await check(
    "create and approval use real separate CLI processes",
    (await cli(["create", "--input", `${run}/input.json`])).exit === 0 &&
      (await cli(["approve", "worker-death", "--operator", "independent-operator"])).exit === 0,
  )
  await cli(["run", "worker-death"])
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !(await Bun.file(`${marker}.pids.json`).exists())) await Bun.sleep(20)
  const commandPIDs = (await Bun.file(`${marker}.pids.json`).json()) as number[]
  for (const pid of commandPIDs) children.set(pid, await identity(pid))
  const workerFile = (await readdir(supervisionRoot)).find((file) => file.endsWith(".worker.json"))
  if (!workerFile) throw new Error("No durable worker identity")
  const worker = (await Bun.file(`${supervisionRoot}/${workerFile}`).json()) as { pid: number }
  children.set(worker.pid, await identity(worker.pid))
  await check(
    "fixture and inherited pipe holder are running before worker death",
    (await Promise.all(commandPIDs.map(running))).every(Boolean),
  )
  const killedAt = Date.now()
  process.kill(worker.pid, "SIGKILL")
  // Deliberately make no product inspect/run/recover call until after the hard deadline.
  await Bun.sleep(timeoutMs + 1800)
  const alive = (await Promise.all(commandPIDs.map(async (pid) => ({ pid, running: await running(pid) })))).filter(
    (entry) => entry.running,
  )
  await check(
    "deadline independently kills TERM-resistant child and pipe holder after worker SIGKILL",
    alive.length === 0,
    {
      elapsedAfterKillMs: Date.now() - killedAt,
      inspectedBeforeDeadline: false,
      livePIDs: alive.map((entry) => entry.pid),
    },
  )
  const guardResultFile = (await readdir(supervisionRoot)).find((file) => file.endsWith(".guard.result.json"))
  const guardResult = guardResultFile ? await Bun.file(`${supervisionRoot}/${guardResultFile}`).json() : undefined
  const observation = await cli(["run", "worker-death"])
  const operation = observation.body.decision.operation
  await check(
    "durable guard failure is adopted without duplicate dispatch",
    operation.executions.length === 1 &&
      operation.executions[0].status === "failed" &&
      guardResult?.status === "failed" &&
      (await Bun.file(marker).text()) === "x",
    { status: operation.executions[0].status },
  )
} finally {
  for (const [pid, start] of children) {
    if (start && start === (await identity(pid))) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {}
    }
  }
}
