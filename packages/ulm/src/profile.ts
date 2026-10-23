import os from "node:os"
import path from "node:path"

export type ProfilePaths = {
  root: string
  configDir: string
  configFile: string
  dataHome: string
  dataDir: string
  stateHome: string
  cacheHome: string
  privateDir: string
  database: string
}

export function resolveProfilePaths(input: { root?: string; home?: string } = {}): ProfilePaths {
  const root = path.resolve(input.root ?? path.join(input.home ?? os.homedir(), ".config", "ulmcode"))
  const dataHome = path.join(root, "xdg", "data")
  return {
    root,
    configDir: path.join(root, "config"),
    configFile: path.join(root, "config", "opencode.json"),
    dataHome,
    dataDir: path.join(dataHome, "opencode"),
    stateHome: path.join(root, "xdg", "state"),
    cacheHome: path.join(root, "xdg", "cache"),
    privateDir: path.join(root, "private"),
    database: "ulmcode.db",
  }
}

export function runtimeEnv(env: Record<string, string | undefined>, paths: ProfilePaths) {
  const result: Record<string, string | undefined> = {
    ...env,
    XDG_CONFIG_HOME: path.join(paths.root, "xdg", "config"),
    XDG_DATA_HOME: paths.dataHome,
    XDG_STATE_HOME: paths.stateHome,
    XDG_CACHE_HOME: paths.cacheHome,
    OPENCODE_CONFIG_DIR: paths.configDir,
    OPENCODE_CONFIG: paths.configFile,
    OPENCODE_DB: paths.database,
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_CONFIG_GLOBAL_DISABLE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_CLIENT: "ulmcode",
    ULMCODE_PROFILE_ROOT: paths.root,
    ULMCODE_CREDENTIALS_DIR: path.join(paths.privateDir, "credentials"),
  }
  delete result.OPENCODE_AUTH_CONTENT
  delete result.OPENCODE_CONFIG_CONTENT
  delete result.OPENAI_API_KEY
  delete result.OPENAI_BASE_URL
  return result
}

export function applyRuntimeEnv(target: Record<string, string | undefined>, filtered: Record<string, string | undefined>) {
  for (const key of Object.keys(target)) if (!(key in filtered)) delete target[key]
  for (const [key, value] of Object.entries(filtered)) {
    if (value === undefined) delete target[key]
    else target[key] = value
  }
}

export * as Profile from "./profile.js"
