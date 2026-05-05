const http = require("node:http")

const port = Number(process.env.PORT || 0)
const studentId = "student-2241"
const inviteCode = "guardian-invite-2241"
const linkedGuardians = new Set(["parent1@district.test"])

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
    json(res, 200, { ok: true, lab: "k12-guardian-invite-takeover" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/guardian/invite") {
    if (url.searchParams.get("studentId") !== studentId) {
      json(res, 404, { error: "unknown_student" })
      return
    }

    json(res, 200, {
      authenticated: false,
      studentId,
      inviteCode,
      expiresInMinutes: 10080,
      labFinding: "guardian_invite_code_disclosure",
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/guardian/accept") {
    const body = await readBody(req)
    if (body.studentId !== studentId || body.inviteCode !== inviteCode) {
      json(res, 403, { linked: false, error: "invalid_invite" })
      return
    }

    linkedGuardians.add(String(body.email || "unknown@example.test"))
    json(res, 200, {
      linked: true,
      studentId,
      guardianEmail: body.email || null,
      guardianCount: linkedGuardians.size,
      verifiedBySchool: false,
      labFinding: "guardian_account_takeover",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/guardian/list") {
    json(res, 200, {
      studentId,
      guardians: Array.from(linkedGuardians),
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
