const http = require("node:http")

const port = Number(process.env.PORT || 0)
const classAssignments = {
  "teacher-north": ["north-homeroom"],
  "teacher-south": ["south-algebra"],
}
const outbox = {
  "north-homeroom": [],
  "south-algebra": [],
}

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
    json(res, 200, { ok: true, lab: "k12-family-messaging-cross-class-broadcast" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/classes") {
    const teacherId = req.headers["x-teacher-id"] || "teacher-north"
    json(res, 200, {
      teacherId,
      classes: (classAssignments[teacherId] || []).map((id) => ({ id })),
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/messages/policy") {
    json(res, 200, {
      teacherOwnershipCheck: "client_hint",
      guardianBroadcastAuth: "classIdOnly",
      warning: "Synthetic lab target. Do not deploy.",
      labFinding: "messaging_class_authorization_gap",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/messages/outbox") {
    const classId = url.searchParams.get("classId") || ""
    json(res, 200, {
      classId,
      messages: outbox[classId] || [],
      labFinding: (outbox[classId] || []).some((message) => message.sentBy === "teacher-north")
        ? "guardian_message_delivered_cross_class"
        : null,
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/messages/broadcast") {
    const body = await readBody(req)
    const teacherId = req.headers["x-teacher-id"] || "teacher-north"
    const classId = body.classId
    const authorizedByOwnership = (classAssignments[teacherId] || []).includes(classId)

    if (!classId || !outbox[classId]) {
      json(res, 400, { accepted: false, error: "unknown_class" })
      return
    }

    outbox[classId].push({
      sentBy: teacherId,
      body: body.body || "",
      guardianRecipients: classId === "south-algebra" ? 2 : 1,
    })

    json(res, 200, {
      accepted: true,
      teacherId,
      classId,
      authorizedByOwnership,
      guardianRecipients: classId === "south-algebra" ? 2 : 1,
      labFinding: authorizedByOwnership ? null : "cross_class_family_broadcast",
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
