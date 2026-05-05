const http = require("node:http")

const port = Number(process.env.PORT || 0)
const studentId = "student-9301"
const eventId = "evt-demo-7788"
let balanceCents = 12500
let lastEventId = null
let seenCount = 0

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
    json(res, 200, { ok: true, lab: "k12-lms-payment-webhook-replay" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/payments/webhook-policy") {
    json(res, 200, {
      signatureMode: "monitor",
      timestampWindow: "disabled",
      idempotency: "disabled",
      warning: "Synthetic lab target. Do not deploy.",
      labFinding: "payment_webhook_replay_controls_missing",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/payments/student-balance") {
    json(res, 200, {
      studentId: url.searchParams.get("studentId"),
      balanceCents,
      lastEventId,
      labFinding: balanceCents < 12500 ? "student_fee_balance_modified_by_replayed_webhook" : null,
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/payments/webhook") {
    const body = await readBody(req)
    const signature = req.headers["x-payment-signature"]

    if (body.type !== "invoice.paid" || body.studentId !== studentId || body.eventId !== eventId) {
      json(res, 400, { accepted: false, error: "unsupported_event" })
      return
    }

    seenCount += 1
    balanceCents -= Number(body.amountCents || 0)
    lastEventId = body.eventId

    json(res, 200, {
      accepted: true,
      signatureVerified: signature === "valid-demo-signature",
      replayed: seenCount > 1,
      studentId,
      balanceCents,
      labFinding: signature === "valid-demo-signature" ? null : "payment_webhook_replay",
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
