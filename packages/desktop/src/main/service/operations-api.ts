import { createHash } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import { app } from "electron"

let child: ChildProcess | undefined

export async function startPackagedOperationsService() {
  if (!app.isPackaged) return

  const profileRoot = process.env.ULMCODE_PROFILE_ROOT
  const workspaceRoot = process.env.ULMCODE_OPERATIONS_WORKSPACE
  const bunPath = process.env.ULMCODE_BUN_PATH
  if (!profileRoot || !workspaceRoot || !bunPath) throw new Error("Packaged ULMCode operations service is missing profile, workspace, or Bun runtime configuration")

  const expectedProfileID = createHash("sha256")
    .update(path.resolve(profileRoot, "private", "credentials"))
    .digest("hex")
  const healthURL = `http://127.0.0.1:${process.env.ULMCODE_OPERATIONS_PORT ?? "4310"}/health`
  const health = await fetch(healthURL, { signal: AbortSignal.timeout(500) })
    .then((response) => response.json() as Promise<{ service?: string; workspaceRoot?: string; profileID?: string }>)
    .catch(() => undefined)
  if (health) {
    if (
      health.service !== "ulmcode-operations" ||
      path.resolve(health.workspaceRoot ?? "") !== path.resolve(workspaceRoot) ||
      health.profileID !== expectedProfileID
    ) {
      throw new Error("ULMCode operations port is occupied by another workspace or profile")
    }
    return
  }

  const host = path.join(process.resourcesPath, "ulmcode", "operations", "server.js")
  const bunDirectory = path.dirname(bunPath)
  child = spawn(bunPath, [host], {
    env: {
      ...process.env,
      PATH: `${bunDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      ULMCODE_ALLOWED_ORIGINS: "oc://renderer",
    },
    stdio: "ignore",
  })
  child.once("error", (error) => console.error("Failed to launch the ULMCode operations service", error.message))
  child.once("exit", (code) => {
    if (code !== 0 && code !== null) console.error("ULMCode operations service exited unexpectedly", { code })
    child = undefined
  })
  app.once("before-quit", stopPackagedOperationsService)
  process.once("exit", stopPackagedOperationsService)

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && child) {
    const ready = await fetch(healthURL, { signal: AbortSignal.timeout(500) })
      .then((response) => response.json() as Promise<{ service?: string; workspaceRoot?: string; profileID?: string }>)
      .catch(() => undefined)
    if (
      ready?.service === "ulmcode-operations" &&
      path.resolve(ready.workspaceRoot ?? "") === path.resolve(workspaceRoot) &&
      ready.profileID === expectedProfileID
    ) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  stopPackagedOperationsService()
  throw new Error("Packaged ULMCode operations service did not become ready")
}

function stopPackagedOperationsService() {
  child?.kill()
  child = undefined
}
