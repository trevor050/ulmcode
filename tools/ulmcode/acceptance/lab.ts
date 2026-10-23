// Independent loopback fixture. This is a target for acceptance, never a product replacement.
import { parseArgs } from "node:util"

const args = parseArgs({ options: { port: { type: "string", default: "0" }, ready: { type: "string" } } })
const requests: { method: string; pathname: string; at: string }[] = []
let faults = 0
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(args.values.port),
  async fetch(request) {
    const url = new URL(request.url)
    requests.push({ method: request.method, pathname: url.pathname, at: new Date().toISOString() })
    if (url.pathname === "/health") return Response.json({ ok: true, status: "ok", fixture: "ulmcode-independent-acceptance-v1" })
    if (url.pathname === "/api/lab") return Response.json({ lab: "Independent synthetic acceptance", observations: [{ kind: "candidate", subject: "local synthetic diagnostic endpoint", summary: "Synthetic unvalidated observation. Requires independent validation before reporting a finding.", confidence: 0.5 }] })
    if (url.pathname === "/inventory") return Response.json({ hosts: [{ address: "127.0.0.1", services: [{ port: server.port, protocol: "http", product: "synthetic-lab" }] }] })
    if (url.pathname === "/candidate") return Response.json({ status: "candidate", title: "Synthetic diagnostic endpoint", evidence: "fixture-public-metadata", validated: false })
    if (url.pathname === "/malformed") return new Response("{malformed fixture", { headers: { "content-type": "application/json" } })
    if (url.pathname === "/flaky" && faults++ === 0) return new Response("Synthetic transient failure", { status: 503 })
    if (url.pathname === "/flaky") return Response.json({ ok: true, attempts: faults })
    if (url.pathname === "/slow") {
      await Bun.sleep(Math.min(Math.max(Number(url.searchParams.get("ms")) || 1000, 0), 10_000))
      return Response.json({ ok: true, delayed: true })
    }
    if (url.pathname === "/requests") return Response.json({ requests })
    return new Response("Synthetic fixture route not found", { status: 404 })
  },
})
const metadata = { schemaVersion: 1, fixture: "ulmcode-independent-acceptance-v1", pid: process.pid, origin: `http://127.0.0.1:${server.port}`, startedAt: new Date().toISOString() }
if (args.values.ready) await Bun.write(args.values.ready, JSON.stringify(metadata, null, 2) + "\n")
console.log(JSON.stringify(metadata))
process.on("SIGTERM", () => { server.stop(true); process.exit(0) })
process.on("SIGINT", () => { server.stop(true); process.exit(0) })
