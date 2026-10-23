import { randomUUID } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { enableCompileCache } from "node:module"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { app } from "electron"
import { applyRuntimeEnv, resolveProfilePaths, runtimeEnv } from "../../../../ulm/src/profile"
import { APP_ID, APP_NAME } from "../constants"

const testOnboarding = process.env.OPENCODE_TEST_ONBOARDING === "1"

const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"

// Runs synchronously from the entry module, before Chromium is ready: command-line switches only
// take effect before ready, the single-instance lock is scoped to userData, and the early window
// needs userData to find the persisted window list and state.
export function configureApplication() {
  const testRoot = createTestRoot()
  if (testRoot) process.env.ULMCODE_PROFILE_ROOT = path.join(testRoot, "profile")
  const profile = resolveProfilePaths({ root: process.env.ULMCODE_PROFILE_ROOT })
  applyRuntimeEnv(process.env, runtimeEnv(process.env, profile))
  Object.assign(process.env, {
    OPENCODE_APP_NAME: "ulmcode",
    OPENCODE_CLIENT: "desktop",
  })
  if (testOnboarding) process.env.OPENCODE_DB = ":memory:"
  mkdirSync(profile.root, { recursive: true, mode: 0o700 })
  mkdirSync(profile.configDir, { recursive: true, mode: 0o700 })
  mkdirSync(profile.privateDir, { recursive: true, mode: 0o700 })
  const template = process.env.ULMCODE_PROFILE_TEMPLATE ?? (app.isPackaged
    ? path.join(process.resourcesPath, "ulmcode", "profile.json")
    : [
        path.resolve(import.meta.dirname, "../../../../../tools/ulmcode/profile.json"),
        path.resolve(import.meta.dirname, "../../../../tools/ulmcode/profile.json"),
      ].find(existsSync))
  if (!template) throw new Error("ULMCode desktop profile template is missing")
  const config = JSON.parse(readFileSync(existsSync(profile.configFile) ? profile.configFile : template, "utf8")) as {
    plugins?: Array<{ package?: string }>
    update?: string
  }
  config.plugins = [{
    package: app.isPackaged
      ? path.join(process.resourcesPath, "ulmcode", "plugin")
      : path.resolve(import.meta.dirname, "../../../../../packages/ulm"),
  }]
  config.update = "disable"
  writeFileSync(profile.configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  process.env.ULMCODE_COMMAND_CATALOG ??= app.isPackaged
    ? path.join(process.resourcesPath, "ulmcode", "command-catalog.json")
    : path.resolve(import.meta.dirname, "../../../../../tools/ulmcode/command-catalog.json")
  if (app.isPackaged) {
    process.env.ULMCODE_BUN_PATH = path.join(
      process.resourcesPath,
      "ulmcode",
      "plugin",
      process.platform === "win32" ? "bun.exe" : "bun",
    )
    process.env.PATH = `${path.dirname(process.env.ULMCODE_BUN_PATH)}${path.delimiter}${process.env.PATH ?? ""}`
  }
  chmodSync(profile.root, 0o700)
  chmodSync(profile.configDir, 0o700)
  chmodSync(profile.privateDir, 0o700)
  chmodSync(profile.configFile, 0o600)

  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  app.setName(APP_NAME)
  app.setAppUserModelId(APP_ID)
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)

  if (!app.isPackaged)
    app.commandLine.appendSwitch("remote-debugging-port", process.env.OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT ?? "9222")

  app.setPath("userData", testRoot ? path.join(testRoot, "desktop") : path.join(app.getPath("appData"), APP_ID))

  if (testRoot) {
    app.setPath("sessionData", path.join(testRoot, "session"))
    app.setPath("documents", path.join(testRoot, "documents"))
  }
  process.env.ULMCODE_OPERATIONS_WORKSPACE ??= path.join(app.getPath("documents"), "Default Project")
  process.env.ULMCODE_OPERATIONS_PORT ??= "4310"
  if (app.isPackaged) process.env.ULMCODE_ALLOWED_ORIGINS ??= "oc://renderer"

  // V8 bytecode for the main bundle survives between launches, like the renderer's code cache.
  enableCompileCache(path.join(app.getPath("userData"), "compile-cache"))
}

export function acquireApplicationLock() {
  if (app.requestSingleInstanceLock()) return true
  app.quit()

  return false
}

function createTestRoot() {
  const supplied = process.env.OPENCODE_DESKTOP_TEST_ROOT
  const root = supplied ?? (testOnboarding
    ? path.join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    : undefined)

  if (!root) return undefined

  if (testOnboarding && !supplied) rmSync(root, { recursive: true, force: true })

  for (const dir of ["data", "config", "cache", "state", "desktop", "session", "documents"])
    mkdirSync(path.join(root, dir), { recursive: true })

  process.env.XDG_DATA_HOME = path.join(root, "data")
  process.env.XDG_CONFIG_HOME = path.join(root, "config")
  process.env.XDG_CACHE_HOME = path.join(root, "cache")
  process.env.XDG_STATE_HOME = path.join(root, "state")

  return root
}
