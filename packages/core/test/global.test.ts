import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "opencode"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  test("app name can be overridden for forked distributions", async () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        "process.env.OPENCODE_APP_NAME='ulmcode'; const mod = await import('./src/global.ts'); console.log(mod.Global.Path.tmp)",
      ],
      cwd: path.join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe(path.join(os.tmpdir(), "ulmcode"))
  })
})
