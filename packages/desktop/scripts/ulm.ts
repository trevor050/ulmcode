import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import path from "node:path"
import { mkdir, copyFile } from "node:fs/promises"
import { homedir } from "node:os"

const command = process.argv[2]
if (command !== "dev" && command !== "build" && command !== "package") {
  throw new Error("Expected one of: dev, build, package")
}
const requestedBun = process.env.ULMCODE_BUILD_BUN_PATH
if (requestedBun && path.resolve(requestedBun) !== path.resolve(process.execPath)) {
  const env = { ...process.env }
  delete env.ULMCODE_BUILD_BUN_PATH
  const reexec = Bun.spawn([path.resolve(requestedBun), path.resolve(process.argv[1]), ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: ["inherit", "inherit", "inherit"],
  })
  process.exit(await reexec.exited)
}
if (Bun.version !== "1.4.4") {
  throw new Error(`ULMCode desktop commands require Bun 1.4.4; set ULMCODE_BUILD_BUN_PATH or invoke with Bun 1.4.4 (found ${Bun.version})`)
}

process.env.ULMCODE_DESKTOP = "1"
process.env.OPENCODE_CHANNEL = "local"
process.env.ULMCODE_PROFILE_TEMPLATE = fileURLToPath(new URL("../../../tools/ulmcode/profile.json", import.meta.url))

const repo = fileURLToPath(new URL("../../..", import.meta.url))
const desktop = fileURLToPath(new URL("..", import.meta.url))
process.env.ULMCODE_CLI_CHANNEL ??= "local"
process.env.ULMCODE_COMMAND_CATALOG = fileURLToPath(new URL("../../../tools/ulmcode/command-catalog.json", import.meta.url))
if (command === "build" || command === "package") {
  const platform = process.platform === "win32" ? "windows" : process.platform
  const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
  if (!process.env.ULMCODE_CLI_BINARY) {
    const cliBuild = Bun.spawn(
      [process.execPath, "run", "script/build.ts", "--single", "--skip-install", "--skip-web-ui"],
      {
        cwd: path.join(repo, "packages", "cli"),
        env: { ...process.env, OPENCODE_CHANNEL: process.env.ULMCODE_CLI_CHANNEL },
        stdio: ["inherit", "inherit", "inherit"],
      },
    )
    if (await cliBuild.exited !== 0) throw new Error("Failed to build the ULMCode CLI before desktop packaging")
    process.env.ULMCODE_CLI_BINARY = path.join(
      repo,
      "packages",
      "cli",
      "dist",
      `cli-${platform}-${process.arch}`,
      "bin",
      executable,
    )
  }
  const cli = path.resolve(process.env.ULMCODE_CLI_BINARY)
  if (!(await Bun.file(cli).exists())) {
    throw new Error(
      `The local ULMCode CLI binary is missing at ${cli}.`,
    )
  }
  const cliVersion = Bun.spawnSync([cli, "--version"], { cwd: repo }).stdout.toString()
  if (!cliVersion.includes(`0.0.0-${process.env.ULMCODE_CLI_CHANNEL}-`)) {
    throw new Error(
      `The local ULMCode CLI binary does not match source channel ${process.env.ULMCODE_CLI_CHANNEL}; set ULMCODE_CLI_BINARY to a matching source build.`,
    )
  }
  process.env.ULMCODE_CLI_BINARY = path.resolve(cli)
}
if (command === "dev") {
  process.env.ULMCODE_BUN_PATH = process.execPath
  process.env.ULMCODE_PROFILE_ROOT ??= process.env.OPENCODE_DESKTOP_TEST_ROOT
    ? path.join(process.env.OPENCODE_DESKTOP_TEST_ROOT, "profile")
    : path.join(homedir(), ".config", "ulmcode")
  process.env.ULMCODE_OPERATIONS_WORKSPACE ??= process.env.OPENCODE_DESKTOP_TEST_ROOT
    ? path.join(process.env.OPENCODE_DESKTOP_TEST_ROOT, "documents", "Default Project")
    : path.join(homedir(), "Documents", "Default Project")
  process.env.ULMCODE_ALLOWED_ORIGINS ??= "http://localhost:5173,http://localhost:4444,oc://renderer"
}

const assets = path.join(desktop, "resources", "ulmcode")
const plugin = path.join(assets, "plugin")
const operationsDirectory = path.join(assets, "operations")
await mkdir(plugin, { recursive: true })
await mkdir(operationsDirectory, { recursive: true })
const bundle = await Bun.build({
  entrypoints: [path.join(repo, "packages", "ulm", "server.ts")],
  outdir: plugin,
  naming: "server.js",
  target: "bun",
  bundle: true,
  external: ["effect", "@opencode/plugin"],
})
if (!bundle.success) {
  console.error(bundle.logs)
  throw new Error("Failed to bundle the ULMCode desktop plugin")
}
const operations = await Bun.build({
  entrypoints: [path.join(desktop, "scripts", "operations-host.ts")],
  outdir: operationsDirectory,
  naming: "server.js",
  target: "bun",
  bundle: true,
})
if (!operations.success) {
  console.error(operations.logs)
  throw new Error("Failed to bundle the ULMCode desktop operations service")
}
await Promise.all([
  copyFile(path.join(repo, "packages", "ulm", "src", "command-worker.ts"), path.join(plugin, "command-worker.ts")),
  copyFile(path.join(repo, "packages", "ulm", "src", "command-worker.ts"), path.join(operationsDirectory, "command-worker.ts")),
  copyFile(path.join(repo, "tools", "ulmcode", "command-catalog.json"), path.join(assets, "command-catalog.json")),
])
if (command === "package") {
  const executable = process.platform === "win32" ? "bun.exe" : "bun"
  await copyFile(process.execPath, path.join(plugin, executable))
  const build = Bun.spawn([process.execPath, "run", "--silent", "build"], {
    cwd: desktop,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` },
    stdio: ["inherit", "inherit", "inherit"],
  })
  if (await build.exited !== 0) throw new Error("Failed to build the ULMCode desktop application before packaging")
}

let operationsProcess: ReturnType<typeof Bun.spawn> | undefined
let ownsOperationsProcess = false
if (command === "dev") {
  const endpoint = "http://127.0.0.1:4310/health"
  const profileRoot = process.env.ULMCODE_PROFILE_ROOT!
  const profileIdentity = createHash("sha256").update(path.resolve(profileRoot, "private", "credentials")).digest("hex")
  const readHealth = () => fetch(endpoint, { signal: AbortSignal.timeout(500) })
    .then((response) => response.json() as Promise<{ service?: string; workspaceRoot?: string; profileID?: string }>)
    .catch(() => undefined)
  const matchesService = (health: Awaited<ReturnType<typeof readHealth>>) =>
    health?.service === "ulmcode-operations" &&
    path.resolve(health.workspaceRoot ?? "") === path.resolve(process.env.ULMCODE_OPERATIONS_WORKSPACE!) &&
    health.profileID === profileIdentity
  const existing = await readHealth()
  if (existing) {
    if (!matchesService(existing))
      throw new Error("Port 4310 is occupied by an operations service for another workspace or profile; refusing to reuse it")
  } else {
    operationsProcess = Bun.spawn([process.execPath, path.join(desktop, "scripts", "operations-host.ts")], {
      cwd: repo,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    })
    ownsOperationsProcess = true
    const deadline = Date.now() + 10_000
    let ready = false
    while (Date.now() < deadline) {
      const health = await readHealth()
      if (matchesService(health)) {
        ready = true
        break
      }
      if (operationsProcess.exitCode !== null) break
      await Bun.sleep(100)
    }
    if (!ready) {
      operationsProcess.kill()
      throw new Error("ULMCode operations service did not become ready on 127.0.0.1:4310")
    }
  }
}

const child = Bun.spawn([process.execPath, "run", "--silent", command, ...process.argv.slice(3)], {
  // Forward Electron flags such as --no-sandbox when running in an isolated Linux display.
  cwd: desktop,
  env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` },
  stdio: ["inherit", "inherit", "inherit"],
})
process.exitCode = await child.exited
if (ownsOperationsProcess && operationsProcess) {
  operationsProcess.kill()
  await operationsProcess.exited
}
