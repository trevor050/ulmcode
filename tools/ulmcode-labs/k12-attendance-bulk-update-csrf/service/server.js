const http = require("node:http")

const port = Number(process.env.PORT || 0)
const attendance = new Map([
  ["student-7101", { studentId: "student-7101", status: "present", reason: null }],
  ["student-7102", { studentId: "student-7102", status: "present", reason: null }],
])

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-attendance-bulk-update-csrf" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/attendance/csrf-policy") {
    json(res, 200, {
      csrfRequired: false,
      originValidation: "disabled",
      cookieSameSite: "none",
      labFinding: "attendance_csrf_controls_missing",
      warning: "Synthetic lab target. Do not deploy.",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/attendance/records") {
    json(res, 200, { records: Array.from(attendance.values()) })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/attendance/bulk-update") {
    const origin = String(req.headers.origin || "")
    const cookie = String(req.headers.cookie || "")
    const body = await readBody(req)
    const updates = Array.isArray(body.updates) ? body.updates : []
    for (const item of updates) {
      attendance.set(String(item.studentId), {
        studentId: String(item.studentId),
        status: String(item.status || "absent"),
        reason: item.reason || "bulk update",
      })
    }
    json(res, 200, {
      accepted: true,
      updateCount: updates.length,
      origin,
      cookieAccepted: cookie.includes("teacher_session="),
      csrfVerified: false,
      records: updates.map((item) => attendance.get(String(item.studentId))),
      labFinding: origin && !origin.includes("school.example.test") ? "attendance_bulk_update_csrf" : undefined,
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
