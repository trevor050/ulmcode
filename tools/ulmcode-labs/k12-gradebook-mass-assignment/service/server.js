const http = require("node:http")

const port = Number(process.env.PORT || 0)
const grades = {
  "student-3001:math-8": {
    studentId: "student-3001",
    courseId: "math-8",
    teacherId: "teacher-math",
    score: 82,
  },
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-gradebook-mass-assignment" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/gradebook/student") {
    const studentId = url.searchParams.get("studentId") || "student-3001"
    const records = Object.values(grades).filter((grade) => grade.studentId === studentId)
    json(res, 200, { studentId, records })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/gradebook/update") {
    const actor = String(req.headers["x-user-id"] || "student-3001")
    const body = await readJson(req)
    const key = `${body.studentId || actor}:${body.courseId || "math-8"}`
    const current = grades[key]
    if (!current) {
      json(res, 404, { error: "grade_not_found" })
      return
    }

    const bodyRole = body.role || "student"
    const bodyTeacher = body.teacherId
    const authorized = bodyRole === "teacher" || body.canEdit === true
    if (!authorized) {
      json(res, 403, { error: "forbidden", warning: "Synthetic lab target. Do not deploy." })
      return
    }

    current.score = Number(body.score)
    json(res, 200, {
      actor,
      bodyRole,
      bodyTeacher,
      authorized: true,
      grade: current,
      labFinding: actor.startsWith("student-") && bodyRole === "teacher" ? "student_grade_mass_assignment" : undefined,
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
