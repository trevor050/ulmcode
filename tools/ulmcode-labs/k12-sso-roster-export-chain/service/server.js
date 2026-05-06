const http = require("node:http")

const port = Number(process.env.PORT || 0)
const session = "sso-admin-session"

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

function authorized(req) {
  return req.headers.authorization === `Bearer ${session}`
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-sso-roster-export-chain" })
    return
  }

  if (req.method === "GET" && url.pathname === "/.well-known/sso-config") {
    json(res, 200, {
      issuer: "https://idp.demo-district.test",
      callbackAllowlist: ["https://admin.demo-district.test/callback", "http://localhost:8080/callback"],
      requireSignedRelayState: false,
      labFinding: "sso_callback_allowlist_overbroad",
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/sso/exchange") {
    const body = await readBody(req)
    if (!String(body.redirectUri || "").startsWith("http://localhost")) {
      json(res, 400, { authenticated: false, error: "redirect_not_allowed" })
      return
    }
    json(res, 200, {
      authenticated: true,
      role: "district-admin",
      mfaRequired: false,
      session,
      labFinding: "sso_admin_session_without_step_up",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/roster/export") {
    if (!authorized(req)) {
      json(res, 401, { authorized: false, error: "missing_session" })
      return
    }
    json(res, 200, {
      authorized: true,
      tenantScope: "all-districts",
      recordCount: 3,
      fields: ["studentId", "iepFlag", "guardianEmail", "homelessStatus"],
      labFinding: "sso_roster_bulk_export_overexposure",
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/vendor/sync") {
    if (!authorized(req)) {
      json(res, 401, { authorized: false, error: "missing_session" })
      return
    }
    const body = await readBody(req)
    json(res, 200, {
      accepted: true,
      vendor: body.vendor || "unknown",
      outboundScopes: ["roster:read", "guardian:read", "student-support:read"],
      approvalRequired: false,
      labFinding: "vendor_sync_excessive_scopes",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/audit/events") {
    json(res, 200, {
      events: [
        { type: "sso_login", severity: "info" },
        { type: "vendor_sync", severity: "info" },
      ],
      elevatedExportAlert: false,
      elevatedVendorAlert: false,
      labFinding: "chained_activity_audit_gap",
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
