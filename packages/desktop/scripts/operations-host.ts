import path from "node:path"
import { homedir } from "node:os"
import { startServer } from "../../ulm/src/server"
import { resolveProfilePaths } from "../../ulm/src/profile"

const profile = resolveProfilePaths({ root: process.env.ULMCODE_PROFILE_ROOT })
const workspaceRoot = path.resolve(
  process.env.ULMCODE_OPERATIONS_WORKSPACE ?? path.join(homedir(), "Documents", "Default Project"),
)
const allowedOrigins = process.env.ULMCODE_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean)
const host = startServer({
  workspaceRoot,
  port: Number(process.env.ULMCODE_OPERATIONS_PORT ?? "4310"),
  credentialsDir: path.join(profile.privateDir, "credentials"),
  commandCatalogPath: process.env.ULMCODE_COMMAND_CATALOG,
  allowedOrigins,
})

console.log(JSON.stringify({ service: "ulmcode-operations", url: host.server.url.href, workspaceRoot }))
process.on("SIGTERM", () => void host.close())
process.on("SIGINT", () => void host.close())
