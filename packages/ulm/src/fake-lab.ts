/** A deliberately synthetic, loopback-only target for local acceptance. */
export function startFakeLab(input: { port?: number; hostname?: string } = {}) {
  const hostname = input.hostname ?? "127.0.0.1"
  if (hostname !== "127.0.0.1" && hostname !== "::1") throw new Error("synthetic lab must bind loopback")
  return Bun.serve({
    hostname,
    port: input.port ?? 4320,
    fetch(request) {
      const url = new URL(request.url)
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 })
      if (url.pathname === "/health") return Response.json({ status: "ok", synthetic: true })
      if (url.pathname === "/api/lab") {
        return Response.json({
          lab: "ULMCode synthetic acceptance lab",
          synthetic: true,
          observations: [
            {
              kind: "configuration",
              subject: "local synthetic HTTP service",
              summary: "The synthetic service deliberately omits a Content-Security-Policy header. Validate an appropriate policy before deploying a comparable real service.",
              confidence: 1,
            },
            {
              kind: "informational",
              subject: "synthetic service metadata",
              summary: "The local acceptance endpoint publishes its synthetic lab identity. This observation proves scoped HTTP collection; it is not an independently validated real-world vulnerability.",
              confidence: 1,
            },
          ],
        })
      }
      return new Response("Synthetic lab endpoint not found", { status: 404 })
    },
  })
}

if (import.meta.main) {
  const server = startFakeLab({ port: Number(process.env.ULMCODE_LAB_PORT ?? "4320") })
  console.log(JSON.stringify({ service: "ulmcode-synthetic-lab", url: server.url.href, synthetic: true }))
  process.on("SIGTERM", () => server.stop(true))
  process.on("SIGINT", () => server.stop(true))
}
