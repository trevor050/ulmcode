import { expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"

test("ulmcode uses ~/.config/ulmcode for Global.Path.config (cross-platform stable)", async () => {
  await using tmp = await tmpdir()

  // Force isolated dirs so importing Global doesn't touch the real machine state.
  process.env.OPENCODE_APP_NAME = "ulmcode"
  process.env.OPENCODE_TEST_HOME = tmp.path
  process.env.XDG_DATA_HOME = path.join(tmp.path, "xdg-data")
  process.env.XDG_CACHE_HOME = path.join(tmp.path, "xdg-cache")
  process.env.XDG_STATE_HOME = path.join(tmp.path, "xdg-state")
  process.env.XDG_CONFIG_HOME = path.join(tmp.path, "xdg-config")

  const mod = await import(`../../src/global/index.ts?test=${Date.now()}`)
  expect(mod.Global.Path.config).toBe(path.join(tmp.path, ".config", "ulmcode"))
})

