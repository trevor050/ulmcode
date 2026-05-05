const http = require("node:http")

const port = Number(process.env.PORT || 0)
const resetToken = "reset-lab-token-7142"
const account = "teacher-reset@district.test"
let resetRequested = false
let passwordChanged = false

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
    })
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-password-reset-token-leak" })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/password-reset/request") {
    const body = await readBody(req)
    resetRequested = body.email === account
    json(res, 200, {
      accepted: true,
      delivery: "email",
      account: body.email || null,
      labFinding: null,
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/support/audit-log") {
    const requestedAccount = url.searchParams.get("account")
    if (requestedAccount !== account || !resetRequested) {
      json(res, 404, { error: "no_events" })
      return
    }

    json(res, 200, {
      authenticated: false,
      events: [
        {
          type: "password_reset_requested",
          account,
          resetToken,
          channel: "email",
        },
      ],
      labFinding: "password_reset_token_leak",
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/password-reset/complete") {
    const body = await readBody(req)
    if (body.account !== account || body.token !== resetToken) {
      json(res, 403, { reset: false, error: "invalid_token" })
      return
    }

    passwordChanged = true
    json(res, 200, {
      reset: true,
      account,
      additionalVerification: false,
      passwordChanged,
      labFinding: "password_reset_token_reuse",
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
