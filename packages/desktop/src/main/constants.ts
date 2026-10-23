import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<Channel, string> = {
  local: "ULMCode Dev",
  dev: "ULMCode Dev",
  beta: "ULMCode Beta",
  prod: "ULMCode",
}

const appIDs: Record<Channel, string> = {
  local: "ai.ulmcode.desktop.dev",
  dev: "ai.ulmcode.desktop.dev",
  beta: "ai.ulmcode.desktop.beta",
  prod: "ai.ulmcode.desktop",
}

export const APP_NAME = appNames[app.isPackaged ? CHANNEL : "dev"]

export const APP_ID = appIDs[app.isPackaged ? CHANNEL : "dev"]
