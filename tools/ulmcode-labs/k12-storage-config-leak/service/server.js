const http = require("node:http")

const port = Number(process.env.PORT || 0)

const files = {
  "student-support/iep-export.csv": [
    "student_id,plan_type,accommodation",
    "stu-4101,synthetic-iep,extended-time",
    "stu-4102,synthetic-504,preferential-seating",
  ].join("\n"),
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-storage-config-leak" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/config/client") {
    json(res, 200, {
      bucket: "demo-district-student-files",
      publicPrefix: "student-support/",
      downloadTemplate: "/api/storage/download?path={path}",
      labFinding: "public_storage_config_leak",
      warning: "Synthetic lab target. Do not deploy.",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/storage/download") {
    const requestedPath = url.searchParams.get("path") || ""
    const content = files[requestedPath]
    if (!content) {
      json(res, 404, { error: "file_not_found" })
      return
    }

    json(res, 200, {
      authenticated: false,
      authorized: true,
      path: requestedPath,
      preview: content.split("\n")[0],
      content,
      labFinding: "unauthenticated_student_file_read",
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
