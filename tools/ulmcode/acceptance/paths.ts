import os from "node:os"
import path from "node:path"
import { existsSync, readdirSync } from "node:fs"

export const checkoutRoot = path.resolve(import.meta.dir, "../../..")
export const evidenceRoot = path.resolve(process.env.ULMCODE_ACCEPTANCE_OUTPUT ?? path.join(os.tmpdir(), "ulmcode-acceptance"))
const browserCache = path.join(os.homedir(), ".cache", "ms-playwright")
const browsers = (existsSync(browserCache) ? readdirSync(browserCache, { withFileTypes: true }) : []).filter((item) => item.isDirectory() && /^chromium-\d+$/.test(item.name)).map((item) => item.name).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
export const chromiumPath = process.env.ULMCODE_CHROMIUM ?? path.join(browserCache, browsers[0] ?? "chromium-not-installed", "chrome-linux64", "chrome")
