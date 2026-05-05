const http = require("node:http")

const port = Number(process.env.PORT || 0)
const token = "vendor-token-demo-5521"
let synced = false

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function bearer(req) {
  const value = req.headers.authorization || ""
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : ""
}

const roster = [
  { studentId: "student-6101", name: "Synthetic North", supportFlag: "504-plan" },
  { studentId: "student-6102", name: "Synthetic South", supportFlag: "counselor-check-in" },
]

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-third-party-integration-token-leak" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/vendor/config") {
    json(res, 200, {
      vendor: "assessment-sync",
      oauthAccessToken: token,
      scopes: ["roster:read", "roster:sync"],
      warning: "Synthetic lab target. Do not deploy.",
      labFinding: "third_party_oauth_token_exposure",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/vendor/roster-preview") {
    if (bearer(req) !== token) {
      json(res, 401, { authorized: false, error: "invalid_token" })
      return
    }
    json(res, 200, {
      authorized: true,
      studentCount: roster.length,
      students: roster,
      sensitiveFieldsReturned: true,
      labFinding: "vendor_token_roster_preview_access",
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/vendor/sync") {
    if (bearer(req) !== token) {
      json(res, 401, { synced: false, error: "invalid_token" })
      return
    }
    synced = true
    json(res, 200, {
      synced,
      importedRecords: roster.length,
      sensitiveFieldsImported: true,
      labFinding: "vendor_token_roster_sync",
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
