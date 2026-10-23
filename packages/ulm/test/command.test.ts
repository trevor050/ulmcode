import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { CommandCatalogError, SupervisedCommandAdapter } from "../src/command"
import { reviewCredential, storeCredential, type CredentialHandle } from "../src/credentials"
import type { LaunchRequest, OperationPhase } from "../src/operation"
import { startFakeLab } from "../src/fake-lab"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture(script: string, options: { credentialsDir?: string; credentialHandles?: string[]; variables?: Record<string, string>; timeoutMs?: number } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ulm-command-"))
  roots.push(root)
  const operationID = "command-test"
  const executionID = crypto.randomUUID()
  const operationDirectory = path.join(root, ".ulmcode", "operations", operationID)
  const catalogPath = path.join(root, "command-catalog.json")
  await Bun.write(catalogPath, JSON.stringify({ schemaVersion: 1, profiles: [{
    profileID: "local-test", safety: "non_destructive", scopes: ["synthetic_lab"], executable: process.execPath,
    args: ["-e", script, "{{target}}", "{{marker}}"], variables: { target: "target", marker: "literal" }, targetPolicy: "loopback",
    timeoutMs: options.timeoutMs ?? 15000, maxOutputBytes: 4096, restart: "inspect_first",
  }] }))
  const adapter = new SupervisedCommandAdapter({ catalogPath, credentialsDir: options.credentialsDir })
  const phase: OperationPhase = {
    id: "local-command", title: "Run local command fixture", dependsOn: [], successCriteria: ["Fixture completes."],
    status: "ready", restart: "inspect_first", required: true, expectedArtifacts: [],
    command: { profileID: "local-test", variables: { target: "http://127.0.0.1:9", marker: "fixture-marker", ...options.variables }, credentialHandles: options.credentialHandles },
  }
  const request: LaunchRequest = {
    operationID, executionID, phase, idempotencyKey: "command:" + executionID, attempt: 1,
    artifactDirectory: operationDirectory, scope: { targets: ["http://127.0.0.1:9"], mode: "synthetic_lab" },
  }
  return { root, operationDirectory, adapter, request, catalogPath }
}

async function waitFor(adapter: SupervisedCommandAdapter, receipt: string) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const observation = await adapter.inspect(receipt)
    if (observation.status !== "running") return observation
    await Bun.sleep(20)
  }
  throw new Error("worker timed out")
}

describe("supervised command adapter", () => {
  test("default catalog captures the synthetic lab's structured observations", async () => {
    const server = startFakeLab({ port: 0 })
    try {
      const root = await mkdtemp(path.join(os.tmpdir(), "ulm-command-default-catalog-"))
      roots.push(root)
      const operationID = "command-test"
      const executionID = crypto.randomUUID()
      const operationDirectory = path.join(root, ".ulmcode", "operations", operationID)
      const adapter = new SupervisedCommandAdapter({ catalogPath: path.resolve(import.meta.dir, "../../../tools/ulmcode/command-catalog.json") })
      const phase: OperationPhase = {
        id: "local-http-observe", title: "Observe the synthetic lab", dependsOn: [], successCriteria: ["Collect the lab observations."],
        status: "ready", restart: "inspect_first", required: true, expectedArtifacts: [],
        command: { profileID: "local-http-observe", variables: { target: server.url.href } },
      }
      const request: LaunchRequest = {
        operationID, executionID, phase, idempotencyKey: "command:" + executionID, attempt: 1,
        artifactDirectory: operationDirectory, scope: { targets: [server.url.href], mode: "synthetic_lab" },
      }
      await adapter.launch(request)
      const result = await waitFor(adapter, adapter.receipt(request))
      expect(result.status, result.summary).toBe("succeeded")
      const output = await readFile(path.join(operationDirectory, "commands", `${executionID}-attempt-1.stdout.txt`), "utf8")
      expect(output).toContain('"synthetic":true')
      expect(output).toContain('"observations":[{"kind":"configuration"')
    } finally {
      server.stop(true)
    }
  })

  test("observes fast worker completion even when readiness and exit race", async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const data = await fixture("process.exit(0)")
      await data.adapter.launch(data.request)
      const result = await waitFor(data.adapter, data.adapter.receipt(data.request))
      expect(result.status, result.summary).toBe("succeeded")
    }
  })

  test("captures completion, survives adapter restart, and does not dispatch twice", async () => {
    const marker = path.join(os.tmpdir(), "ulm-command-marker-" + crypto.randomUUID())
    const fixtureData = await fixture("require('node:fs').appendFileSync(process.argv[2], 'x'); process.stdout.write('local complete')", { variables: { marker } })
    await Promise.all([fixtureData.adapter.launch(fixtureData.request), fixtureData.adapter.launch(fixtureData.request)])
    const receipt = fixtureData.adapter.receipt(fixtureData.request)
    const done = await waitFor(fixtureData.adapter, receipt)
    expect(done.status).toBe("succeeded")
    expect(await readFile(path.join(fixtureData.operationDirectory, "commands", fixtureData.request.executionID + "-attempt-1.stdout.txt"), "utf8")).toContain("local complete")
    expect(await readFile(marker, "utf8")).toBe("x")
    const restarted = new SupervisedCommandAdapter({ catalogPath: fixtureData.catalogPath })
    expect((await restarted.inspect(receipt)).status).toBe("succeeded")
    await restarted.launch(fixtureData.request)
    expect(await readFile(marker, "utf8")).toBe("x")
    await rm(marker, { force: true })
  })

  test("records a nonzero exit even when stderr is empty", async () => {
    const data = await fixture("process.exit(7)")
    await data.adapter.launch(data.request)
    const result = await waitFor(data.adapter, data.adapter.receipt(data.request))
    expect(result.status).toBe("failed")
    expect(result.summary).toContain("code 7")
    expect(await readFile(path.join(data.operationDirectory, "commands", data.request.executionID + "-attempt-1.stderr.txt"), "utf8")).toBe("\n")
  })

  test("interrupts the owned process and redacts credential output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ulm-command-vault-"))
    roots.push(root)
    const operationID = "command-test"
    const operationDirectory = path.join(root, ".ulmcode", "operations", operationID)
    const credentialsDir = path.join(root, "vault")
    const credentialID = "cred_secret1" as CredentialHandle
    const target = "http://127.0.0.1:9"
    const marker = path.join(root, "child-started")
    await storeCredential({ credentialsDir, operationRoot: operationDirectory, operationID, credential: credentialID, value: { secret: "private-test-secret" } })
    await reviewCredential({ credentialsDir, operationRoot: operationDirectory, operationID, credentialID, reviewedBy: "operator", authorizedTargets: [target] })
    const data = await fixture("const fs=require('node:fs'); const s=process.env.ULMCODE_CREDENTIAL_SECRET1_SECRET; process.stdout.write(s.slice(0,5)); fs.writeFileSync(process.argv[2], 'started'); setTimeout(()=>process.stdout.write(s.slice(5)),10); setTimeout(()=>{},30000)", { credentialsDir, credentialHandles: [credentialID], variables: { marker } })
    const request = { ...data.request, artifactDirectory: operationDirectory }
    await data.adapter.launch(request)
    const receipt = data.adapter.receipt(request)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !(await Bun.file(marker).exists())) await Bun.sleep(10)
    await data.adapter.interrupt(receipt, request)
    const result = await waitFor(data.adapter, receipt)
    expect(result.status, result.summary).toBe("interrupted")
    const output = (await Promise.all(result.artifactRefs.map((artifact) => readFile(path.join(operationDirectory, artifact.path), "utf8")))).join("\n")
    expect(output).toContain("[REDACTED]")
    expect(output).not.toContain("private-test-secret")
    expect(await readdir(path.join(root, ".ulmcode", "supervision", operationID))).toHaveLength(0)
    expect(await readFile(path.join(operationDirectory, "commands", request.executionID + "-attempt-1.json"), "utf8")).not.toContain("private-test-secret")
  })

  test("rejects secret-shaped variables before dispatch", async () => {
    const data = await fixture("process.exit(0)")
    data.request.phase.command!.variables.password = "not-a-secret"
    await expect(data.adapter.launch(data.request)).rejects.toBeInstanceOf(CommandCatalogError)
  })

  test("keeps the hard deadline active while inherited pipe holders remain open", async () => {
    const data = await fixture("require('node:child_process').spawn(process.execPath, ['-e', 'process.on(\"SIGTERM\",()=>{}); setTimeout(()=>{},30000)'], {stdio:'inherit'})", { timeoutMs: 500 })
    await data.adapter.launch(data.request)
    const result = await waitFor(data.adapter, data.adapter.receipt(data.request))
    expect(result.status).toBe("failed")
    expect(result.summary).toContain("time limit")
  })

  test("external watchdog bounds a command after its worker is killed", async () => {
    const marker = path.join(os.tmpdir(), "ulm-command-crash-pid-" + crypto.randomUUID())
    const data = await fixture("require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setTimeout(()=>{},30000)", { timeoutMs: 500, variables: { marker } })
    await data.adapter.launch(data.request)
    const receipt = data.adapter.receipt(data.request)
    const identityPath = path.join(data.root, ".ulmcode", "supervision", data.request.operationID, `${data.request.executionID}-attempt-1.worker.json`)
    const commandPath = path.join(data.root, ".ulmcode", "supervision", data.request.operationID, `${data.request.executionID}-attempt-1.command.json`)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !(await Bun.file(marker).exists())) await Bun.sleep(10)
    const command = JSON.parse(await readFile(commandPath, "utf8")) as { pid: number; processStart: string; processGroupID: number; watchdogPID: number; watchdogStart: string; deadlineAt: string }
    const worker = JSON.parse(await readFile(identityPath, "utf8")) as { pid: number; processStart: string }
    process.kill(worker.pid, "SIGKILL")
    const watchdogDeadline = Date.now() + 2500
    let commandStillOwned = true
    while (Date.now() < watchdogDeadline) {
      try {
        const stat = await readFile(`/proc/${command.pid}/stat`, "utf8")
        const start = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19]
        commandStillOwned = `${start}:` === command.processStart.slice(0, command.processStart.indexOf(":")) + ":"
      } catch { commandStillOwned = false }
      if (!commandStillOwned) break
      await Bun.sleep(20)
    }
    expect(commandStillOwned).toBe(false)
    let processGroupExists = true
    try { process.kill(-command.processGroupID, 0) } catch (error) { processGroupExists = (error as NodeJS.ErrnoException).code !== "ESRCH" }
    expect(processGroupExists).toBe(false)
    expect(Date.now()).toBeLessThan(Date.parse(command.deadlineAt) + 1500)
    const guardResult = path.join(data.root, ".ulmcode", "supervision", data.request.operationID, `${data.request.executionID}-attempt-1.guard.result.json`)
    const guardResultDeadline = Date.now() + 2000
    while (Date.now() < guardResultDeadline && !(await Bun.file(guardResult).exists())) await Bun.sleep(10)
    const restarted = new SupervisedCommandAdapter({ catalogPath: data.catalogPath })
    const workerResult = path.join(data.operationDirectory, "commands", `${data.request.executionID}-attempt-1.result.json`)
    expect(await Bun.file(guardResult).exists(), JSON.stringify({ command, worker, workerResultExists: await Bun.file(workerResult).exists() })).toBe(true)
    expect((await restarted.inspect(receipt)).status).toBe("failed")
    const markerBefore = await readFile(marker, "utf8")
    await restarted.launch(data.request)
    expect(await readFile(marker, "utf8")).toBe(markerBefore)
  })

  test("interrupts the verified watchdog tree after its worker is gone", async () => {
    const marker = path.join(os.tmpdir(), "ulm-command-interrupt-pid-" + crypto.randomUUID())
    const data = await fixture("require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setTimeout(()=>{},30000)", { timeoutMs: 5000, variables: { marker } })
    await data.adapter.launch(data.request)
    const receipt = data.adapter.receipt(data.request)
    const identityPath = path.join(data.root, ".ulmcode", "supervision", data.request.operationID, `${data.request.executionID}-attempt-1.worker.json`)
    const commandPath = path.join(data.root, ".ulmcode", "supervision", data.request.operationID, `${data.request.executionID}-attempt-1.command.json`)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !(await Bun.file(marker).exists())) await Bun.sleep(10)
    const command = JSON.parse(await readFile(commandPath, "utf8")) as { pid: number; processStart: string; processGroupID: number; watchdogPID: number; watchdogStart: string }
    const worker = JSON.parse(await readFile(identityPath, "utf8")) as { pid: number; processStart: string }
    process.kill(worker.pid, "SIGKILL")
    await data.adapter.interrupt(receipt, data.request)
    const result = await data.adapter.inspect(receipt)
    expect(result.status, result.summary).toBe("interrupted")
    let processGroupExists = true
    try { process.kill(-command.processGroupID, 0) } catch (error) { processGroupExists = (error as NodeJS.ErrnoException).code !== "ESRCH" }
    expect(processGroupExists).toBe(false)
  })
})
