import { app } from "electron"
import path from "node:path"

export function serviceRegistrationFile() {
  const channel = process.env.OPENCODE_DESKTOP_SERVER_CHANNEL
  if (!channel || ["latest", "dev", "beta", "next"].includes(channel)) return undefined
  return path.join(
    process.env.XDG_STATE_HOME ?? path.join(app.getPath("home"), ".local", "state"),
    "opencode",
    `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`,
  )
}
