import { parseArgs } from "node:util"
import { mkdir, readFile } from "node:fs/promises"
import { chromium } from "../../../packages/app/node_modules/@playwright/test/index.mjs"
import { evidenceRoot, chromiumPath } from "./paths"

const args = parseArgs({ options: { "password-file": { type: "string" }, operation: { type: "string" }, app: { type: "string", default: "http://localhost:4444" }, server: { type: "string", default: "http://127.0.0.1:4096" } } })
if (!args.values["password-file"] || !args.values.operation) throw new Error("Provide --password-file <private transient fixture file> and --operation <synthetic ID>")
const run = `${evidenceRoot}/app-vault-link-${new Date().toISOString().replace(/[:.]/g, "-")}`
await mkdir(run, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath, headless: !process.env.ACCEPTANCE_HEADED, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(args.values.app)
  await page.getByRole("button", { name: "Use password", exact: true }).click()
  await page.locator('input[name="server"]').fill(args.values.server)
  await page.locator('input[name="password"]').fill((await readFile(args.values["password-file"], "utf8")).trim())
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await page.getByRole("button", { name: "Operations", exact: true }).waitFor()
  await page.goto(`${args.values.app}/operations/${encodeURIComponent(args.values.operation)}`)
  const link = page.getByRole("link", { name: "Open credential vault", exact: true })
  await link.waitFor()
  const popupPromise = page.waitForEvent("popup")
  const responsePromise = page.context().waitForEvent("response", { predicate: (response) => new URL(response.url()).pathname.endsWith("/vault") })
  await link.click()
  const popup = await popupPromise
  const response = await responsePromise
  await popup.getByRole("heading", { name: "Submit credentials to this operation", exact: true }).waitFor()
  if (process.env.ACCEPTANCE_HEADED) await popup.screenshot({ path: `${run}/empty-vault-opened-from-app.png`, fullPage: true })
  const result = { accepted: true, app: args.values.app, operation: args.values.operation, responseStatus: response?.status(), actualVaultPath: new URL(popup.url()).pathname, emptyCredentialFields: await popup.locator('input[name="username"]').inputValue() === "" && await popup.locator('input[name="password"]').inputValue() === "", submitted: false }
  await Bun.write(`${run}/results.json`, JSON.stringify(result, null, 2) + "\n")
  console.log("Actual app vault link opens the empty standalone form")
} finally { await browser.close() }
