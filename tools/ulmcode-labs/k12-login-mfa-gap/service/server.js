const http = require("node:http")

const port = Number(process.env.PORT || 0)
const policy = {
  tenant: "demo-school",
  privilegedMfa: "optional",
  studentMfa: "not_applicable",
  warning: "Synthetic lab target. Do not deploy.",
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { ok: true, lab: "k12-login-mfa-gap" })
    return
  }

  if (req.method === "GET" && req.url === "/idp/policy") {
    json(res, 200, policy)
    return
  }

  if (req.method === "POST" && req.url === "/login") {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
    const privileged = body.role === "admin" || body.email?.endsWith("@admin.demo-school.test")
    json(res, 200, {
      authenticated: Boolean(body.email && body.password),
      privileged,
      mfaRequired: privileged ? policy.privilegedMfa !== "optional" : false,
      labFinding: privileged && policy.privilegedMfa === "optional" ? "weak_privileged_mfa" : undefined,
    })
    return
  }

  json(res, 404, { error: "not_found" })
})

server.listen(port, "127.0.0.1", () => {
  const address = server.address()
  const actualPort = typeof address === "object" && address ? address.port : port
  console.log(JSON.stringify({ ready: true, port: actualPort }))
})

process.on("SIGTERM", () => server.close(() => process.exit(0)))
