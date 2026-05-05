const http = require("node:http")

const port = Number(process.env.PORT || 0)
const students = {
  "student-8201": {
    studentId: "student-8201",
    name: "Synthetic Transcript Student",
    gradeLevel: "10",
    gpa: 3.6,
    accommodations: "extended testing time",
    disciplineNote: "synthetic counseling referral",
    guardianEmail: "guardian8201@example.test",
  },
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-transcript-export-overexposure" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/transcripts/export-schema") {
    json(res, 200, {
      defaultFields: ["studentId", "name", "gradeLevel", "gpa"],
      includeAllAdds: ["accommodations", "disciplineNote", "guardianEmail"],
      roleRequiredForSensitiveFields: false,
      labFinding: "transcript_sensitive_field_policy_gap",
      warning: "Synthetic lab target. Do not deploy.",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/transcripts/export") {
    const requesterRole = String(req.headers["x-role"] || "teacher")
    const studentId = url.searchParams.get("studentId") || "student-8201"
    const include = url.searchParams.get("include") || "default"
    const student = students[studentId]
    if (!student) {
      json(res, 404, { error: "student_not_found" })
      return
    }
    const base = {
      studentId: student.studentId,
      name: student.name,
      gradeLevel: student.gradeLevel,
      gpa: student.gpa,
    }
    const sensitive = include === "all"
    json(res, 200, {
      requesterRole,
      export: sensitive ? { ...base, ...student } : base,
      sensitiveFieldsReturned: sensitive,
      labFinding: sensitive ? "transcript_export_overexposure" : undefined,
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
