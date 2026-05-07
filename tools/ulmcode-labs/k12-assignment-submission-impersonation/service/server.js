const http = require("node:http")

const port = Number(process.env.PORT || 0)
const submissions = new Map([
  ["student-4401:essay-7", { studentId: "student-4401", assignmentId: "essay-7", text: "Original draft" }],
  ["student-4402:essay-7", { studentId: "student-4402", assignmentId: "essay-7", text: "Peer draft" }],
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
    json(res, 200, { ok: true, lab: "k12-assignment-submission-impersonation" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/assignments/submission") {
    const studentId = url.searchParams.get("studentId") || "student-4401"
    const assignmentId = url.searchParams.get("assignmentId") || "essay-7"
    json(res, 200, submissions.get(`${studentId}:${assignmentId}`) || { studentId, assignmentId, text: null })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/assignments/submit") {
    const actor = String(req.headers["x-student-id"] || "student-4401")
    const body = await readBody(req)
    const studentId = body.studentId || actor
    const assignmentId = body.assignmentId || "essay-7"
    const record = {
      studentId,
      assignmentId,
      text: body.text || "",
      submittedBy: actor,
      ownershipChecked: false,
    }
    submissions.set(`${studentId}:${assignmentId}`, record)
    json(res, 200, {
      accepted: true,
      submission: record,
      labFinding: studentId !== actor ? "assignment_submission_impersonation" : undefined,
      warning: "Synthetic lab target. Do not deploy.",
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
