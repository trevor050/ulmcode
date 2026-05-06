const http = require("node:http")

const port = Number(process.env.PORT || 0)
const classes = {
  "north-homeroom": {
    schoolId: "north",
    teacherId: "teacher-north",
    students: [{ id: "stu-1001", name: "Synthetic North Student", grade: "7" }],
  },
  "south-algebra": {
    schoolId: "south",
    teacherId: "teacher-south",
    students: [{ id: "stu-2001", name: "Synthetic South Student", grade: "8" }],
  },
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-roster-idor" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/classes") {
    const teacherId = req.headers["x-teacher-id"] || "teacher-north"
    json(res, 200, {
      teacherId,
      classes: Object.entries(classes)
        .filter(([, item]) => item.teacherId === teacherId)
        .map(([id, item]) => ({ id, schoolId: item.schoolId })),
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/roster") {
    const teacherId = String(req.headers["x-teacher-id"] || "teacher-north")
    const classId = url.searchParams.get("classId") || "north-homeroom"
    const klass = classes[classId]
    if (!klass) {
      json(res, 404, { error: "class_not_found" })
      return
    }

    const crossTenant = klass.teacherId !== teacherId
    json(res, 200, {
      requestTeacher: teacherId,
      classId,
      authorized: true,
      students: klass.students,
      labFinding: crossTenant ? "cross_tenant_roster_read" : undefined,
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
