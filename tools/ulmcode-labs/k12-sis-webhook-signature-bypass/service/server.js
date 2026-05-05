const http = require("node:http")

const port = Number(process.env.PORT || 0)
const studentId = "student-5109"
const originalGuardianEmail = "verified-guardian@example.test"
const attackerGuardianEmail = "attacker-guardian@example.test"
let guardianEmail = originalGuardianEmail
let guardianSource = "district-import"
let verifiedBySchool = true

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
    json(res, 200, { ok: true, lab: "k12-sis-webhook-signature-bypass" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/webhooks/sis/policy") {
    json(res, 200, {
      signatureMode: "warn",
      trustedSourceBypass: "source=trusted-sis",
      acceptedEventTypes: ["student.guardian.updated"],
      warning: "Synthetic lab target. Do not deploy.",
      labFinding: "sis_webhook_signature_not_enforced",
    })
    return
  }

  if (req.method === "GET" && url.pathname === `/api/students/${studentId}/guardian`) {
    json(res, 200, {
      studentId,
      guardianEmail,
      verifiedBySchool,
      source: guardianSource,
      labFinding:
        guardianEmail === attackerGuardianEmail ? "guardian_contact_modified_by_unsigned_webhook" : null,
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/webhooks/sis/events") {
    const body = await readBody(req)
    const signature = req.headers["x-sis-signature"]
    const trustedSource = url.searchParams.get("source") === "trusted-sis"

    if (!trustedSource && signature !== "valid-demo-signature") {
      json(res, 401, {
        accepted: false,
        signatureVerified: false,
        error: "invalid_signature",
      })
      return
    }

    if (body.type !== "student.guardian.updated" || body.studentId !== studentId || !body.guardianEmail) {
      json(res, 400, { accepted: false, error: "unsupported_event" })
      return
    }

    guardianEmail = body.guardianEmail
    guardianSource = "sis-webhook"
    verifiedBySchool = false

    json(res, 200, {
      accepted: true,
      signatureVerified: signature === "valid-demo-signature",
      studentId,
      guardianEmail,
      labFinding: signature === "valid-demo-signature" ? null : "sis_webhook_signature_bypass",
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
