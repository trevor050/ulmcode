const http = require("node:http")

const port = Number(process.env.PORT || 0)

const students = [
  { id: "stu-5101", name: "Synthetic North Student", classId: "north-homeroom" },
  { id: "stu-6201", name: "Synthetic South Student", classId: "south-algebra" },
  { id: "stu-7301", name: "Synthetic East Student", classId: "east-science" },
]

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function search(query) {
  const lowered = query.toLowerCase()
  if (query.includes("'") && query.includes("1")) return students
  return students.filter((student) => student.name.toLowerCase().includes(lowered))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-student-search-injection" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/students/search") {
    const query = url.searchParams.get("q") || ""
    const results = search(query)
    json(res, 200, {
      query,
      results,
      resultCount: results.length,
      labFinding: results.length > 1 && query.includes("'") ? "student_search_query_injection" : undefined,
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
