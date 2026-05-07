import path from "node:path"
import { pathToFileURL } from "node:url"

const pluginPath = process.argv[2]
if (!pluginPath) throw new Error("usage: check-runtime-guard.mjs <plugin-path>")

const mod = await import(pathToFileURL(path.resolve(pluginPath)).href)
if (!mod.default || mod.default.id !== "ulmcode-runtime-guard") {
  throw new Error("runtime guard plugin default export is missing expected id")
}

const hooks = await mod.default.server()
const system = { system: [] }
await hooks["experimental.chat.system.transform"]({}, system)
if (!system.system.some((line) => line.includes("operation_resume"))) {
  throw new Error("runtime guard did not inject operation_resume guidance")
}
if (!system.system.some((line) => line.includes("recoverStaleTasks=true"))) {
  throw new Error("runtime guard did not inject unattended stale-lane recovery guidance")
}

const env = { env: {} }
await hooks["shell.env"]({}, env)
if (env.env.ULMCODE_PROFILE !== "1" || env.env.OPENCODE_DISABLE_PROJECT_CONFIG !== "1") {
  throw new Error("runtime guard did not inject expected shell environment")
}

const tool = { description: "Task tool.", parameters: {} }
await hooks["tool.definition"]({ toolID: "task" }, tool)
if (!tool.description.includes("ULMCode background guidance")) {
  throw new Error("runtime guard did not append task tool guidance")
}

console.log("runtime_guard: ok")
