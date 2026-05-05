const crypto = require("node:crypto")
const http = require("node:http")

const port = Number(process.env.PORT || 0)
const consumerKey = "district-lms"
const sharedSecret = "lti-secret-demo-9421"

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function signLaunch(body) {
  return crypto.createHmac("sha256", sharedSecret).update(JSON.stringify(body)).digest("hex")
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? JSON.parse(text) : {}
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, lab: "k12-lti-shared-secret-leak" })
    return
  }

  if (req.method === "GET" && url.pathname === "/.well-known/lti-config.json") {
    json(res, 200, {
      consumerKey,
      launchUrl: "/lti/launch",
      sharedSecret,
      labFinding: "lti_shared_secret_disclosure",
      warning: "Synthetic lab target. Do not deploy.",
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/lti/launch") {
    const body = await readJson(req)
    const expected = signLaunch({
      consumerKey: body.consumerKey,
      userId: body.userId,
      role: body.role,
      courseId: body.courseId,
    })
    if (body.consumerKey !== consumerKey || body.signature !== expected) {
      json(res, 403, { launched: false, error: "invalid_lti_signature" })
      return
    }

    json(res, 200, {
      launched: true,
      userId: body.userId,
      role: body.role,
      courseId: body.courseId,
      gradebookWrite: body.role === "Instructor",
      labFinding: body.role === "Instructor" ? "forged_lti_instructor_launch" : undefined,
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
