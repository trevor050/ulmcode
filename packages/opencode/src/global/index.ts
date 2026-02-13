import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

function detectAppName() {
  // Allow explicit override for enterprise/test harnesses.
  const forced = process.env.OPENCODE_APP_NAME
  if (forced) return forced

  // When running the compiled CLI, prefer a stable per-app config/data root.
  // During dev/tests, argv[0] is typically "bun", so we intentionally fall back to "opencode".
  const exe = path.basename(process.execPath || process.argv[0] || "").toLowerCase().replace(/\\.exe$/, "")
  if (exe === "ulmcode") return "ulmcode"
  if (exe === "opencode") return "opencode"
  return "opencode"
}

const app = detectAppName()

// We want a consistent, human-discoverable profile path for ULMCode across platforms.
// This also matches what `ulmcode profile init` generates and what our installers use.
const home = process.env.OPENCODE_TEST_HOME || os.homedir()

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = app === "ulmcode" ? path.join(home, ".config", "ulmcode") : path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

export namespace Global {
  export const Path = {
    // Allow override via OPENCODE_TEST_HOME for test isolation
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}
