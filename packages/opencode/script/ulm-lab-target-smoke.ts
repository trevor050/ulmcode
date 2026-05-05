#!/usr/bin/env bun

import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../..")
const service = path.join(repoRoot, "tools", "ulmcode-labs", "k12-login-mfa-gap", "service", "server.js")
const proc = Bun.spawn(["bun", service], {
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, PORT: "0" },
})

function fail(message: string): never {
  proc.kill()
  throw new Error(message)
}

const reader = proc.stdout.getReader()
const timeout = setTimeout(() => fail("lab service did not start"), 5000)
const readyChunk = await reader.read()
clearTimeout(timeout)
const readyText = new TextDecoder().decode(readyChunk.value)
const ready = JSON.parse(readyText.trim()) as { port?: number }
if (!ready.port) fail("lab service did not report a port")

const base = `http://127.0.0.1:${ready.port}`
const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
if (!health.ok || health.lab !== "k12-login-mfa-gap") fail("health probe failed")

const policy = await fetch(`${base}/idp/policy`).then((res) => res.json()) as { privilegedMfa?: string }
if (policy.privilegedMfa !== "optional") fail("policy probe did not expose weak privileged MFA")

const login = await fetch(`${base}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "principal@admin.demo-school.test", password: "lab-password", role: "admin" }),
}).then((res) => res.json()) as { authenticated?: boolean; privileged?: boolean; mfaRequired?: boolean; labFinding?: string }

if (!login.authenticated || !login.privileged || login.mfaRequired || login.labFinding !== "weak_privileged_mfa") {
  fail("login probe did not confirm weak privileged MFA")
}

proc.kill()
await proc.exited

console.log("ulm_lab_target: ok")
console.log("target: k12-login-mfa-gap")
console.log("weak_privileged_mfa: confirmed")
