import { mkdir, readdir, readFile } from "node:fs/promises"
import { chromium } from "../../../packages/app/node_modules/@playwright/test/index.mjs"
import { materializeCredential } from "../../../packages/ulm/src/credentials"
import { checkoutRoot, evidenceRoot, chromiumPath } from "./paths"

const run = `${evidenceRoot}/vault-${new Date().toISOString().replace(/[:.]/g, "-")}`
await mkdir(`${run}/workspace/.ulmcode/operations`, { recursive: true })
await mkdir(`${run}/private`, { recursive: true, mode: 0o700 })
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reservation") })
const port = reservation.port
reservation.stop(true)
const origin = `http://127.0.0.1:${port}`
const command = [process.execPath, `${checkoutRoot}/packages/ulm/src/cli.ts`, "serve", "--workspace", `${run}/workspace`, "--profile-root", `${run}/private/profile`, "--port", String(port)]
const child = Bun.spawn(command, { cwd: checkoutRoot, stdout: Bun.file(`${run}/host.stdout.log`), stderr: Bun.file(`${run}/host.stderr.log`) })
const results: { name: string; passed: boolean; detail?: unknown }[] = []
const sentinels = { username: crypto.randomUUID(), password: crypto.randomUUID(), notes: crypto.randomUUID() }
async function check(name: string, passed: boolean, detail?: unknown) { results.push({ name, passed, detail }); console.log(`${name}: ${passed ? "PASS" : "FAIL"}`); await Bun.write(`${run}/results.json`, JSON.stringify({ run, command, results }, null, 2) + "\n"); if (!passed) throw new Error(name) }
const browser = await chromium.launch({ executablePath: chromiumPath, headless: !process.env.ACCEPTANCE_HEADED, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Vault host exited ${child.exitCode}`)
    if (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) }).then((response) => response.ok).catch(() => false)) break
    await Bun.sleep(100)
  }
  const create = async (id: string) => fetch(`${origin}/api/operations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, sessionID: `session-${id}`, objective: "Independent local credential vault browser acceptance", scope: { targets: ["http://127.0.0.1:1"], mode: "synthetic_lab" } }) })
  await check("vault-enabled host creates scoped operation", (await create("vault-one")).status === 201)
  await create("vault-two")
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } })
  const form = await page.goto(`${origin}/api/operations/vault-one/vault`)
  await check("real standalone form loads with no-store", form?.status() === 200 && Boolean(form.headers()["cache-control"]?.includes("no-store")))
  await page.getByRole("heading", { name: "Submit credentials to this operation", exact: true }).waitFor()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  if (process.env.ACCEPTANCE_HEADED) await page.screenshot({ path: `${run}/01-empty-vault.png`, fullPage: true })
  const token = await page.locator('input[name="token"]').inputValue()
  await page.getByLabel("Username", { exact: true }).fill(sentinels.username)
  await page.getByLabel("Password", { exact: true }).fill(sentinels.password)
  await page.locator('textarea[name="notes"]').fill(sentinels.notes)
  await page.locator('input[name="authorizedTarget"]').check()
  await page.getByLabel("Reviewed by", { exact: true }).fill("independent-local-operator")
  await page.locator('input[name="authorize"]').check()
  const submitted = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/vault/submit"))
  await page.getByRole("button", { name: "Submit to agent", exact: true }).click()
  const response = await submitted
  const responseBody = await response.text()
  const safeResponse = Object.values(sentinels).reduce((text, value) => text.replaceAll(value, "[PRIVATE VALUE REDACTED]"), responseBody.replaceAll(token, "[PRIVATE TOKEN REDACTED]"))
  await check("form HTTP submission succeeds", response.status() === 201, { status: response.status(), origin: response.request().headers().origin, contentType: response.request().headers()["content-type"], pageHeading: await page.getByRole("heading").allTextContents(), failureText: response.status() === 201 ? undefined : safeResponse })
  await page.getByRole("heading", { name: "Submitted to agent", exact: true }).waitFor()
  const text = await page.locator("body").innerText()
  await check("actual browser submit approved and values never echoed", response.status() === 201 && Object.values(sentinels).every((value) => !text.includes(value)))
  if (process.env.ACCEPTANCE_HEADED) await page.screenshot({ path: `${run}/02-approved-handle-masked.png`, fullPage: true, mask: [page.locator("code")] })
  const status = await fetch(`${origin}/api/operations/vault-one/credentials`).then((response) => response.json())
  const publicText = JSON.stringify(status)
  await check("public credential API returns reviewed metadata only", status.credentials.length === 1 && status.credentials[0].status === "approved" && Object.values(sentinels).every((value) => !publicText.includes(value)), { submitted: status.reviewStatus.submitted, reviewed: status.reviewStatus.reviewed })
  const material = await materializeCredential({ credentialsDir: `${run}/private/profile/private/credentials`, operationRoot: `${run}/workspace/.ulmcode/operations/vault-one`, operationID: "vault-one", credentialID: status.credentials[0].credentialID, target: "http://127.0.0.1:1", executionID: "acceptance-vault" })
  await check("browser submission actually materializes privately", Object.values(material).includes(sentinels.password) && Object.values(material).includes(sentinels.username))
  const fields = new URLSearchParams({ token, username: sentinels.username, password: sentinels.password, reviewedBy: "independent-local-operator", authorize: "yes", authorizedTarget: "http://127.0.0.1:1" })
  const replay = await fetch(`${origin}/api/operations/vault-one/vault/submit`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: fields })
  await check("consumed form token cannot replay", replay.status === 403)
  const cross = await fetch(`${origin}/api/operations/vault-two/vault/submit`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: fields })
  await check("form token cannot cross operations", cross.status === 403)
  const files = await walk(`${run}/workspace`)
  const leaks = await Promise.all(files.map(async (file) => { const content = await readFile(file); return { file, matched: Object.values(sentinels).some((sentinel) => content.includes(Buffer.from(sentinel))) } }))
  await check("operation files contain no submitted raw sentinels", leaks.every((item) => !item.matched), { checkedFiles: files.length, leakingFiles: leaks.filter((item) => item.matched).map((item) => item.file) })
} finally {
  await browser.close()
  child.kill("SIGTERM")
  await Promise.race([child.exited, Bun.sleep(5000).then(() => child.kill("SIGKILL"))])
}
async function walk(root: string): Promise<string[]> { return (await Promise.all((await readdir(root, { withFileTypes: true })).map((entry) => entry.isDirectory() ? walk(`${root}/${entry.name}`) : [`${root}/${entry.name}`]))).flat() }
