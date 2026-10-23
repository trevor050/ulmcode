import { checkoutRoot, chromiumPath } from "./paths"
import { parseArgs } from "node:util"
import { existsSync } from "node:fs"

const args = parseArgs({ options: { checkout: { type: "string", default: checkoutRoot }, output: { type: "string" } } })
const checkout = args.values.checkout
const checks = await Promise.all([
  ["bun", [process.execPath, "--version"]],
  ["node", ["node", "--version"]],
  ["gitHead", ["git", "-C", checkout, "rev-parse", "HEAD"]],
  ["branch", ["git", "-C", checkout, "branch", "--show-current"]],
  ["pdfinfo", ["pdfinfo", "-v"]],
].map(async ([name, command]) => {
  const child = Bun.spawn(command as string[], { stdout: "pipe", stderr: "pipe", timeout: 5000 })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { name, code, output: (stdout || stderr).trim().split("\n").slice(0, 2).join("\n") }
}))
const pkg = await Bun.file(`${checkout}/package.json`).json()
const result = {
  checkedAt: new Date().toISOString(), checkout, checks,
  packageManager: pkg.packageManager,
  displayConfigured: Boolean(process.env.DISPLAY),
  waylandConfigured: Boolean(process.env.WAYLAND_DISPLAY),
  chromiumCached: existsSync(chromiumPath),
  rootDependenciesPresent: existsSync(`${checkout}/node_modules`),
  currentDevTargetExists: existsSync(`${checkout}/packages/opencode`),
  currentCliExists: existsSync(`${checkout}/packages/cli/src/index.ts`),
  status: "environment_inventory_only_not_product_acceptance",
}
if (args.values.output) await Bun.write(args.values.output, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
