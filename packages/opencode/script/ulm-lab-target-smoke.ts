#!/usr/bin/env bun

import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../..")

function fail(proc: ReturnType<typeof Bun.spawn>, message: string): never {
  proc.kill()
  throw new Error(message)
}

async function startTarget(id: string) {
  const service = path.join(repoRoot, "tools", "ulmcode-labs", id, "service", "server.js")
  const proc = Bun.spawn(["bun", service], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PORT: "0" },
  })

  const reader = proc.stdout.getReader()
  const timeout = setTimeout(() => fail(proc, `${id} service did not start`), 5000)
  const readyChunk = await reader.read()
  clearTimeout(timeout)
  const readyText = new TextDecoder().decode(readyChunk.value)
  const ready = JSON.parse(readyText.trim()) as { port?: number }
  if (!ready.port) fail(proc, `${id} service did not report a port`)
  return { proc, base: `http://127.0.0.1:${ready.port}` }
}

async function probeMfaGap() {
  const { proc, base } = await startTarget("k12-login-mfa-gap")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-login-mfa-gap") fail(proc, "health probe failed")

  const policy = await fetch(`${base}/idp/policy`).then((res) => res.json()) as { privilegedMfa?: string }
  if (policy.privilegedMfa !== "optional") fail(proc, "policy probe did not expose weak privileged MFA")

  const login = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "principal@admin.demo-school.test", password: "lab-password", role: "admin" }),
  }).then((res) => res.json()) as { authenticated?: boolean; privileged?: boolean; mfaRequired?: boolean; labFinding?: string }

  if (!login.authenticated || !login.privileged || login.mfaRequired || login.labFinding !== "weak_privileged_mfa") {
    fail(proc, "login probe did not confirm weak privileged MFA")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-login-mfa-gap", "weak_privileged_mfa: confirmed"]
}

async function probeRosterIdor() {
  const { proc, base } = await startTarget("k12-roster-idor")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-roster-idor") fail(proc, "health probe failed")

  const owned = await fetch(`${base}/api/classes`, {
    headers: { "x-teacher-id": "teacher-north" },
  }).then((res) => res.json()) as { classes?: Array<{ id?: string }> }
  if (!owned.classes?.some((item) => item.id === "north-homeroom")) fail(proc, "owned class probe failed")

  const roster = await fetch(`${base}/api/roster?classId=south-algebra`, {
    headers: { "x-teacher-id": "teacher-north" },
  }).then((res) => res.json()) as { authorized?: boolean; students?: unknown[]; labFinding?: string }
  if (!roster.authorized || !roster.students?.length || roster.labFinding !== "cross_tenant_roster_read") {
    fail(proc, "roster probe did not confirm cross-tenant read")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-roster-idor", "cross_tenant_roster_read: confirmed"]
}

async function probeGradebookMassAssignment() {
  const { proc, base } = await startTarget("k12-gradebook-mass-assignment")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-gradebook-mass-assignment") fail(proc, "health probe failed")

  const before = await fetch(`${base}/api/gradebook/student?studentId=student-3001`).then((res) => res.json()) as {
    records?: Array<{ score?: number }>
  }
  if (before.records?.[0]?.score !== 82) fail(proc, "gradebook baseline probe failed")

  const update = await fetch(`${base}/api/gradebook/update`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": "student-3001" },
    body: JSON.stringify({
      studentId: "student-3001",
      courseId: "math-8",
      role: "teacher",
      teacherId: "teacher-math",
      score: 100,
    }),
  }).then((res) => res.json()) as { authorized?: boolean; grade?: { score?: number }; labFinding?: string }

  if (!update.authorized || update.grade?.score !== 100 || update.labFinding !== "student_grade_mass_assignment") {
    fail(proc, "gradebook probe did not confirm student write escalation")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-gradebook-mass-assignment", "student_grade_mass_assignment: confirmed"]
}

const lines = [
  "ulm_lab_target: ok",
  ...(await probeMfaGap()),
  ...(await probeRosterIdor()),
  ...(await probeGradebookMassAssignment()),
]

console.log(lines.join("\n"))
