const http = require("node:http")

const port = Number(process.env.PORT || 0)
const session = "district-admin-session"

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
    json(res, 200, { ok: true, lab: "k12-district-portal-chained-exposure" })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/admin/session-policy") {
    json(res, 200, {
      adminMfa: "optional",
      stepUpForExports: false,
      warning: "Synthetic lab target. Do not deploy.",
      labFinding: "district_admin_mfa_optional",
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readBody(req)
    if (body.email !== "district-admin@example.test" || body.password !== "lab-password") {
      json(res, 401, { authenticated: false, error: "invalid_credentials" })
      return
    }
    json(res, 200, {
      authenticated: true,
      role: "district-admin",
      mfaRequired: false,
      session,
      labFinding: "district_admin_login_without_mfa",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/admin/export-policy") {
    json(res, 200, {
      includeAllAllowed: true,
      tenantFilter: "disabled",
      sensitiveFields: ["iepFlag", "guardianEmail", "disciplineNote"],
      labFinding: "student_export_policy_overbroad",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/admin/students/export") {
    if (!authorized(req)) {
      json(res, 401, { authorized: false, error: "missing_session" })
      return
    }
    json(res, 200, {
      authorized: true,
      districts: ["north", "south"],
      records: [
        {
          district: "north",
          studentId: "student-9910",
          iepFlag: true,
          guardianEmail: "north-guardian@example.test",
          disciplineNote: "synthetic discipline note",
        },
        {
          district: "south",
          studentId: "student-8820",
          iepFlag: true,
          guardianEmail: "south-guardian@example.test",
          disciplineNote: "synthetic counseling referral",
        },
      ],
      sensitiveFieldsReturned: url.searchParams.get("include") === "all",
      recordCount: 2,
      labFinding: "cross_district_student_export",
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/admin/audit/export-events") {
    json(res, 200, {
      events: [{ type: "report_view", severity: "info", actor: "district-admin" }],
      elevatedExportAlert: false,
      labFinding: "sensitive_export_audit_gap",
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
