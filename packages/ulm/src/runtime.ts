import { createHash } from "node:crypto"
import { ToolFailure } from "@opencode/ai"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { OperationEngine } from "@ulmcode/operations/engine"
import { OperationStore } from "@ulmcode/operations/store"
import { completionBlockers } from "@ulmcode/operations/goal"
import { LoopbackLabAdapter } from "@ulmcode/operations/lab"
import { CompositeExecutionAdapter, SupervisedCommandAdapter } from "@ulmcode/operations/command"
import { lintReport, renderReport } from "@ulmcode/operations/report"
import { listCredentials } from "@ulmcode/operations/credentials"
import { Effect, Schema, Stream } from "effect"

const PlanInput = Schema.Struct({
  assumptions: Schema.Array(Schema.String),
  successCriteria: Schema.Array(Schema.String),
  phases: Schema.Array(Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    dependsOn: Schema.Array(Schema.String),
    successCriteria: Schema.Array(Schema.String),
    restart: Schema.Literals(["safe", "inspect_first", "never"]),
    required: Schema.Boolean,
    expectedArtifacts: Schema.Array(Schema.String),
    command: Schema.Struct({
      profileID: Schema.String,
      variables: Schema.Record(Schema.String, Schema.String),
      credentialHandles: Schema.Array(Schema.String).pipe(Schema.optional),
    }).pipe(Schema.optional),
  })).check(Schema.isMinLength(1)),
})

const CreateInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional),
  objective: Schema.String,
  targets: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  mode: Schema.Literals(["synthetic_lab", "authorized"]),
  authorizationRef: Schema.String.pipe(Schema.optional),
  maxNoToolTurns: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(8)).pipe(Schema.optional),
  plan: PlanInput.pipe(Schema.optional),
})

const ApproveInput = Schema.Struct({
  operationID: Schema.String,
  approvedBy: Schema.String,
})

const WritePlanInput = Schema.Struct({
  operationID: Schema.String.pipe(Schema.optional),
  objective: Schema.String.pipe(Schema.optional),
  targets: Schema.Array(Schema.String).pipe(Schema.optional),
  mode: Schema.Literals(["synthetic_lab", "authorized"]).pipe(Schema.optional),
  authorizationRef: Schema.String.pipe(Schema.optional),
  plan: PlanInput,
})

const OperationInput = Schema.Struct({ operationID: Schema.String })
const OptionalOperationInput = Schema.Struct({ operationID: Schema.String.pipe(Schema.optional) })
const InterruptInput = Schema.Struct({ operationID: Schema.String, reason: Schema.String.pipe(Schema.optional) })
const ReviewInput = Schema.Struct({
  operationID: Schema.String,
  verdict: Schema.Literals(["continue", "done", "needs_operator"]),
  reason: Schema.String.pipe(Schema.optional),
})

const HandoffInput = Schema.Struct({
  operationID: Schema.String,
  phaseID: Schema.String,
  agent: Schema.String,
  task: Schema.String,
})

const CredentialInput = Schema.Struct({
  operationID: Schema.String,
  action: Schema.Literals(["open_vault", "list", "get", "review_status"]),
  credentialID: Schema.String.pipe(Schema.optional),
})

const NO_TOOL_LIMIT = "No-tool continuation limit reached; operator input is required"

function message(error: unknown) {
  return error instanceof Error ? error.message : "ULM runtime operation failed"
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function loopbackTarget(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
  } catch {
    return false
  }
}

export function usedToolSincePreviousIdle(messages: ReadonlyArray<{ type: string; content?: ReadonlyArray<{ type: string }> }>) {
  const lastIdle = messages.findLastIndex((item) => item.type === "idle")
  const previousIdle = messages.findLastIndex((item, index) => item.type === "idle" && index < lastIdle)
  return messages.slice(previousIdle + 1, lastIdle).some((item) => item.type === "assistant" && item.content?.some((part) => part.type === "tool"))
}

export function parseVerdict(text: string): { verdict: "continue" | "done" | "needs_operator"; reason: string } | undefined {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return undefined
  try {
    const value = JSON.parse(match[0]) as { verdict?: unknown; reason?: unknown }
    if (value.verdict !== "continue" && value.verdict !== "done" && value.verdict !== "needs_operator") return undefined
    return { verdict: value.verdict, reason: typeof value.reason === "string" ? value.reason.slice(0, 1000) : "" }
  } catch {
    return undefined
  }
}

export const RuntimePlugin = define({
  id: "ulmcode.operations.runtime",
  effect: Effect.fn("ULM.Runtime.Plugin")(function* (ctx: Context) {
    const workspaceRoot = ctx.location.project.directory
    const store = yield* Effect.acquireRelease(
      Effect.sync(() => new OperationStore({ workspaceRoot })),
      (value) => Effect.promise(() => value.close()),
    )
    const catalogPath = process.env.ULMCODE_COMMAND_CATALOG
    const commands = catalogPath ? new SupervisedCommandAdapter({
      catalogPath,
      credentialsDir: process.env.ULMCODE_CREDENTIALS_DIR,
      bunPath: process.env.ULMCODE_BUN_PATH,
    }) : undefined
    const adapter = commands
      ? new CompositeExecutionAdapter({ commands, loopback: new LoopbackLabAdapter() })
      : new LoopbackLabAdapter()
    const engine = new OperationEngine({ store, workspaceRoot, adapter })
    const isBoundOwner = (record: { sessionIDs: ReadonlyArray<string> }, sessionID: string) =>
      ctx.session.get({ sessionID: Session.ID.make(sessionID) }).pipe(
        Effect.map((session) => record.sessionIDs.includes(sessionID) && session.parentID === undefined),
        Effect.mapError((error) => new ToolFailure({ message: message(error), error })),
      )

    yield* ctx.tool.transform((editor) => {
      editor.add({
        name: "operation_create",
        options: { codemode: false },
        description: "Create and bind a durable ULM operation to this chat. Use synthetic_lab only with an explicitly approved local lab; authorized scope requires an opaque authorization reference. Creating an operation does not approve its plan or launch work.",
        input: CreateInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.tryPromise({
          try: async () => {
            if (input.mode === "synthetic_lab" && (input.targets.length !== 1 || !input.targets[0] || !loopbackTarget(input.targets[0]))) {
              throw new Error("synthetic_lab accepts exactly one credential-free loopback HTTP origin")
            }
            if (input.mode === "authorized" && !input.authorizationRef?.trim()) throw new Error("authorized scope requires an opaque operator authorization reference")
            const operation = await engine.create({
              id: input.id,
              sessionID: invocation.sessionID,
              objective: input.objective,
              scope: { targets: [...input.targets], mode: input.mode, authorizationRef: input.authorizationRef },
              plan: input.plan ? {
                assumptions: input.plan.assumptions.map((item) => item),
                successCriteria: input.plan.successCriteria.map((item) => item),
                phases: input.plan.phases.map((phase) => ({ ...phase, dependsOn: phase.dependsOn.map((item) => item), successCriteria: phase.successCriteria.map((item) => item), expectedArtifacts: phase.expectedArtifacts.map((item) => item), command: phase.command ? { profileID: phase.command.profileID, variables: { ...phase.command.variables }, credentialHandles: phase.command.credentialHandles?.map((item) => item) } : undefined })),
                reporting: { required: true, renderer: "ulmcode-report" },
              } : undefined,
              goal: { continuation: { enabled: true, maxNoToolTurns: input.maxNoToolTurns ?? 1 } },
            })
            return { output: { operationID: operation.id, status: operation.status }, content: `Created operation ${operation.id} in draft status and bound it to this session.` }
          },
          catch: (error) => new ToolFailure({ message: message(error), error }),
        }),
      })
      editor.add({
        name: "operation_status",
        options: { codemode: false },
        description: "Read the operation explicitly bound to this chat, or read a supplied operation ID. A fresh chat never inherits another operation implicitly.",
        input: Schema.Struct({ operationID: Schema.String.pipe(Schema.optional) }),
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.tryPromise({
          try: async () => {
            const record = input.operationID
              ? await store.get(input.operationID)
              : await store.forSession(invocation.sessionID)
            if (!record) return { output: { bound: false }, content: "No operation is bound to this chat." }
            return { output: record, content: JSON.stringify(record, null, 2) }
          },
          catch: (error) => new ToolFailure({ message: message(error), error }),
        }),
      })
      editor.add({
        name: "operation_resume",
        options: { codemode: false },
        description: "Resume or recover the exact operation named by the operator, or the operation already bound to this chat. A named operation is explicitly bound to this session; no newest-operation fallback exists.",
        input: OptionalOperationInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.gen(function* () {
          const session = yield* ctx.session.get({ sessionID: invocation.sessionID }).pipe(Effect.mapError((error) => new ToolFailure({ message: message(error), error })))
          if (session.parentID) return yield* new ToolFailure({ message: "only a top-level session can resume an operation" })
          const record = yield* Effect.tryPromise({ try: () => input.operationID ? store.get(input.operationID) : store.forSession(invocation.sessionID), catch: (error) => new ToolFailure({ message: message(error), error }) })
          if (!record) return yield* new ToolFailure({ message: "no exact operation was selected or bound to this chat" })
          const bound = yield* Effect.tryPromise({ try: () => store.bindSession(record.id, invocation.sessionID), catch: (error) => new ToolFailure({ message: message(error), error }) })
          const recovery = yield* Effect.tryPromise({ try: () => engine.recover(bound.id), catch: (error) => new ToolFailure({ message: message(error), error }) })
          return { output: recovery, content: JSON.stringify(recovery, null, 2) }
        }),
      })
      editor.add({
        name: "operation_recover",
        options: { codemode: false },
        description: "Reconcile persisted execution receipts for the exact operation named or bound to this chat. Unknown dispatch outcomes remain blocked and are never relaunched automatically.",
        input: OptionalOperationInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.gen(function* () {
          const record = yield* Effect.tryPromise({ try: () => input.operationID ? store.get(input.operationID) : store.forSession(invocation.sessionID), catch: (error) => new ToolFailure({ message: message(error), error }) })
          if (!record || !(yield* isBoundOwner(record, invocation.sessionID))) return yield* new ToolFailure({ message: "operation recovery requires a bound top-level owner session" })
          const recovery = yield* Effect.tryPromise({ try: () => engine.recover(record.id), catch: (error) => new ToolFailure({ message: message(error), error }) })
          return { output: recovery, content: JSON.stringify(recovery, null, 2) }
        }),
      })
      editor.add({
        name: "operation_interrupt",
        options: { codemode: false },
        description: "Interrupt active execution for the operation bound to this chat.",
        input: InterruptInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.gen(function* () {
          const record = yield* Effect.tryPromise({ try: () => store.get(input.operationID), catch: (error) => new ToolFailure({ message: message(error), error }) })
          if (!record || !(yield* isBoundOwner(record, invocation.sessionID))) return yield* new ToolFailure({ message: "operation interruption requires a bound top-level owner session" })
          const updated = yield* Effect.tryPromise({ try: () => engine.interrupt(record.id, input.reason ?? "Interrupted from the bound session"), catch: (error) => new ToolFailure({ message: message(error), error }) })
          return { output: updated, content: `Interrupted operation ${updated.id}.` }
        }),
      })
      editor.add({
        name: "operation_plan",
        options: { codemode: false },
        description: "Create a new bound operation plan or revise the plan of a bound draft operation. Plan writing never approves the plan; use operation_approve_plan after operator review.",
        input: WritePlanInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.gen(function* () {
            const plan = {
              assumptions: input.plan.assumptions.map((item) => item),
              successCriteria: input.plan.successCriteria.map((item) => item),
              phases: input.plan.phases.map((phase) => ({ ...phase, dependsOn: phase.dependsOn.map((item) => item), successCriteria: phase.successCriteria.map((item) => item), expectedArtifacts: phase.expectedArtifacts.map((item) => item), command: phase.command ? { profileID: phase.command.profileID, variables: { ...phase.command.variables }, credentialHandles: phase.command.credentialHandles?.map((item) => item) } : undefined })),
              reporting: { required: true, renderer: "ulmcode-report" },
            }
            if (input.operationID) {
              const record = yield* Effect.tryPromise({ try: () => store.get(input.operationID!), catch: (error) => new ToolFailure({ message: message(error), error }) })
              if (!record || !(yield* isBoundOwner(record, invocation.sessionID))) return yield* new ToolFailure({ message: "operation plan update requires a bound top-level owner session" })
              const updated = yield* Effect.tryPromise({ try: () => engine.setPlan(record.id, plan), catch: (error) => new ToolFailure({ message: message(error), error }) })
              return { output: { operationID: updated.id, status: updated.status, planVersion: updated.plan?.version }, content: `Saved plan version ${updated.plan?.version} for operation ${updated.id}. Operator approval is still required.` }
            }
            const objective = input.objective
            const targets = input.targets
            const mode = input.mode
            if (!objective || !targets?.length || !mode) return yield* new ToolFailure({ message: "creating a plan requires objective, targets, and mode" })
            if (mode === "synthetic_lab" && (targets.length !== 1 || !targets[0] || !loopbackTarget(targets[0]))) return yield* new ToolFailure({ message: "synthetic_lab accepts exactly one credential-free loopback HTTP origin" })
            if (mode === "authorized" && !input.authorizationRef?.trim()) return yield* new ToolFailure({ message: "authorized scope requires an opaque operator authorization reference" })
            const created = yield* Effect.tryPromise({ try: () => engine.create({
              sessionID: invocation.sessionID,
              objective,
              scope: { targets: [...targets], mode, authorizationRef: input.authorizationRef },
              plan,
              goal: { continuation: { enabled: true, maxNoToolTurns: 1 } },
            }), catch: (error) => new ToolFailure({ message: message(error), error }) })
            return { output: { operationID: created.id, status: created.status, planVersion: created.plan?.version }, content: `Created operation ${created.id} in draft status and saved its plan. Operator approval is still required.` }
        }),
      })
      editor.add({
        name: "operation_approve_plan",
        options: { codemode: false },
        description: "Approve the ordered phase plan after operator review. Approval requires the configured operation_approve_plan permission and an operator identity.",
        input: ApproveInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.gen(function* () {
          const record = yield* Effect.tryPromise({ try: () => store.get(input.operationID), catch: (error) => new ToolFailure({ message: message(error), error }) })
          if (!record) return yield* new ToolFailure({ message: `unknown operation ${input.operationID}` })
          if (!(yield* isBoundOwner(record, invocation.sessionID))) return yield* new ToolFailure({ message: "plan approval requires a bound top-level owner session" })
          if (!record.plan) return yield* new ToolFailure({ message: "operation has no plan" })
          if (record.plan.approvedAt) {
            if (record.plan.approvedBy === input.approvedBy) return { output: { operationID: record.id, status: record.status }, content: `Plan for operation ${record.id} was already approved.` }
            return yield* new ToolFailure({ message: "operation plan was already approved by a different operator" })
          }
          yield* ctx.permission.assert({
            action: "operation_approve_plan",
            resources: [record.id],
            metadata: { approvedBy: input.approvedBy },
            sessionID: invocation.sessionID,
            agent: invocation.agent,
            source: { type: "tool", messageID: invocation.messageID, id: invocation.id },
          })
          const planned = yield* Effect.tryPromise({ try: () => engine.approvePlan(record.id, { approvedBy: input.approvedBy }), catch: (error) => new ToolFailure({ message: message(error), error }) })
          return { output: { operationID: planned.id, status: planned.status }, content: `Approved plan for operation ${planned.id}.` }
        }),
      })
      editor.add({
        name: "operation_run",
        options: { codemode: false },
        description: "Advance one approved phase. Default runtime is limited to the synthetic loopback lab; authorized scope requires an explicit trusted supervised-command catalog and a phase command entry.",
        input: OperationInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.gen(function* () {
          const record = yield* Effect.tryPromise({ try: () => store.get(input.operationID), catch: (error) => new ToolFailure({ message: message(error), error }) })
          if (!record || !(yield* isBoundOwner(record, invocation.sessionID))) return yield* new ToolFailure({ message: "operation_run requires an exact bound top-level owner session; child sessions cannot schedule operation work" })
          const active = record.executions.find((execution) => execution.status === "intent" || execution.status === "running")
          const activePhase = active && record.plan?.phases.find((phase) => phase.id === active.phaseID)
          const readyPhase = record.plan?.phases.find((phase) => phase.status === "ready")
          const phase = activePhase ?? readyPhase
          if (record.scope.mode === "synthetic_lab" && record.scope.targets.some((target) => !loopbackTarget(target))) return yield* new ToolFailure({ message: "synthetic_lab accepts credential-free loopback HTTP origins only" })
          if (record.scope.mode === "authorized" && (!catalogPath || !phase?.command)) return yield* new ToolFailure({ message: "authorized execution requires an explicit trusted command catalog and command metadata on the next phase; no external work was dispatched" })
          if (phase?.command && !catalogPath) return yield* new ToolFailure({ message: "phase command metadata requires ULMCODE_COMMAND_CATALOG; no command was dispatched" })
          if (phase?.command && commands) {
            yield* Effect.try({
              try: () => commands.validatePhase({
                operationID: record.id,
                executionID: "runtime-preflight",
                phase,
                idempotencyKey: "runtime-preflight",
                attempt: 0,
                artifactDirectory: store.directory(record.id),
                scope: record.scope,
              }),
              catch: (error) => new ToolFailure({ message: message(error), error }),
            })
          }
          const result = yield* Effect.tryPromise({ try: () => engine.tick(record.id), catch: (error) => new ToolFailure({ message: message(error), error }) })
          return { output: result, content: JSON.stringify(result, null, 2) }
        }),
      })
      editor.add({
        name: "operation_goal_review",
        options: { codemode: false },
        description: "Record an explicit goal review and evaluate artifact completion gates. Use needs_operator when authorization or evidence is uncertain.",
        input: ReviewInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.gen(function* () {
          const record = yield* Effect.tryPromise({ try: () => store.get(input.operationID), catch: (error) => new ToolFailure({ message: message(error), error }) })
          if (!record || !(yield* isBoundOwner(record, invocation.sessionID))) return yield* new ToolFailure({ message: "goal review requires a bound top-level owner session" })
          const result = yield* Effect.tryPromise({ try: () => engine.reviewGoal(record.id, input.verdict, { reason: input.reason, toolUsed: true, idempotencyKey: `runtime.manual-goal:${invocation.messageID}:${invocation.id}` }), catch: (error) => new ToolFailure({ message: message(error), error }) })
          return { output: result, content: JSON.stringify(result, null, 2) }
        }),
      })
      editor.add({
        name: "operation_credentials",
        options: { codemode: false },
        description: "Open the operator-only credential submission form or inspect redacted credential handles and review status. Never returns usernames, notes, passwords, secrets, or vault contents.",
        input: CredentialInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.gen(function* () {
          const record = yield* Effect.tryPromise({ try: () => store.get(input.operationID), catch: (error) => new ToolFailure({ message: message(error), error }) })
          if (!record || !record.sessionIDs.includes(invocation.sessionID)) return yield* new ToolFailure({ message: "operation is missing or not bound to this chat" })
          yield* ctx.permission.assert({
            action: "operation_credentials",
            resources: [record.id],
            sessionID: invocation.sessionID,
            agent: invocation.agent,
            source: { type: "tool", messageID: invocation.messageID, id: invocation.id },
          })
          if (input.action === "open_vault") {
            const configured = process.env.ULMCODE_OPERATIONS_URL ?? "http://127.0.0.1:4310"
            let base: URL
            try {
              base = new URL(configured)
            } catch (error) {
              return yield* new ToolFailure({ message: "ULMCODE_OPERATIONS_URL is invalid", error })
            }
            if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) {
              return yield* new ToolFailure({ message: "The credential vault URL must use credential-free loopback HTTP" })
            }
            base.pathname = `/api/operations/${encodeURIComponent(record.id)}/vault`
            base.search = ""
            base.hash = ""
            return { output: { operationID: record.id, url: base.toString() }, content: `Open this operator-only local credential form, submit credentials, then return to the bound chat: ${base.toString()}` }
          }
          const credentials = yield* Effect.tryPromise({
            try: () => listCredentials(store.directory(record.id), record.id),
            catch: (error) => new ToolFailure({ message: message(error), error }),
          })
          if (input.action === "get") {
            if (!input.credentialID) return yield* new ToolFailure({ message: "get requires a credentialID" })
            const credential = credentials.find((item) => item.credentialID === input.credentialID)
            if (!credential) return yield* new ToolFailure({ message: "credential handle not found" })
            return { output: credential, content: JSON.stringify(credential, null, 2) }
          }
          if (input.action === "review_status") {
            const summary = { operationID: record.id, total: credentials.length, needsReview: credentials.filter((item) => item.status === "needs_review").length, approved: credentials.filter((item) => item.status === "approved").length, reauthRequired: credentials.filter((item) => item.status === "reauth_required").length, credentials }
            return { output: summary, content: JSON.stringify(summary, null, 2) }
          }
          return { output: credentials, content: JSON.stringify(credentials, null, 2) }
        }),
      })
      editor.add({
        name: "evidence_normalize",
        options: { codemode: false },
        description: "Normalize registered operation evidence into the canonical operation evidence artifact.",
        input: OperationInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.tryPromise({
          try: async () => {
            const record = await store.get(input.operationID)
            if (!record || !record.sessionIDs.includes(invocation.sessionID)) throw new Error("operation is missing or not bound to this chat")
            const updated = await engine.normalizeEvidence(record.id)
            return { output: updated.evidence, content: JSON.stringify(updated.evidence, null, 2) }
          },
          catch: (error) => new ToolFailure({ message: message(error), error }),
        }),
      })
      editor.add({
        name: "report_render",
        options: { codemode: false },
        description: "Render the canonical operation report, register all output hashes against the exact source revision, and evaluate artifact completion gates.",
        input: OperationInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.tryPromise({
          try: async () => {
            const record = await store.get(input.operationID)
            if (!record || !record.sessionIDs.includes(invocation.sessionID)) throw new Error("operation is missing or not bound to this chat")
            const report = await renderReport({ operation: record, operationDirectory: store.directory(record.id), chromiumPath: process.env.ULMCODE_CHROMIUM })
            if (!report.pdfRendered) throw new Error(`PDF rendering failed: ${report.pdfError ?? "renderer unavailable"}`)
            const registered = await engine.recordReport(record.id, {
              artifacts: report.artifacts,
              sourceRevision: record.revision,
              sourceDigest: report.sourceDigest,
            })
            const completion = await engine.evaluateCompletion(record.id)
            const lint = await lintReport({ operation: completion.operation, operationDirectory: store.directory(record.id) })
            return {
              output: { operation: completion.operation, completed: completion.completed, blockers: completion.blockers, lint },
              content: `Rendered report for ${registered.id}. Completion: ${completion.completed ? "complete" : "blocked"}. ${completion.blockers.join("; ") || "All artifact gates passed."} Report lint: ${lint.ok ? "passed" : lint.gaps.join("; ")}.`,
            }
          },
          catch: (error) => new ToolFailure({ message: message(error), error }),
        }),
      })
      editor.add({
        name: "report_lint",
        options: { codemode: false },
        description: "Check canonical report files, manifest hashes, source revision, and current operation audit without changing them.",
        input: OperationInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.tryPromise({
          try: async () => {
            const record = await store.get(input.operationID)
            if (!record || !record.sessionIDs.includes(invocation.sessionID)) throw new Error("operation is missing or not bound to this chat")
            const lint = await lintReport({ operation: record, operationDirectory: store.directory(record.id) })
            return { output: lint, content: JSON.stringify(lint, null, 2) }
          },
          catch: (error) => new ToolFailure({ message: message(error), error }),
        }),
      })
      editor.add({
        name: "operation_audit",
        options: { codemode: false },
        description: "Evaluate and persist the operation's current artifact completion audit.",
        input: OperationInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.tryPromise({
          try: async () => {
            const record = await store.get(input.operationID)
            if (!record || !record.sessionIDs.includes(invocation.sessionID)) throw new Error("operation is missing or not bound to this chat")
            const result = await engine.evaluateCompletion(record.id)
            return { output: result, content: JSON.stringify(result, null, 2) }
          },
          catch: (error) => new ToolFailure({ message: message(error), error }),
        }),
      })
      editor.add({
        name: "operation_handoff",
        options: { codemode: false },
        description: "Create a durable child session for one planned phase, bind it to this operation, and return its completed work summary. Child output is not phase completion until the declared artifact and success criteria are verified.",
        input: HandoffInput,
        output: Schema.Unknown,
        execute: (input, invocation) => Effect.gen(function* () {
            const record = yield* Effect.tryPromise({ try: () => store.get(input.operationID), catch: (error) => new ToolFailure({ message: message(error), error }) })
            const phase = record?.plan?.phases.find((item) => item.id === input.phaseID)
            if (!record || !phase || !(yield* isBoundOwner(record, invocation.sessionID))) return yield* new ToolFailure({ message: "only a bound top-level owner session may hand off planned phases" })
            if (!record.plan?.approvedAt) return yield* new ToolFailure({ message: "approve the operation plan before delegating a phase" })
            if (phase.status !== "ready") return yield* new ToolFailure({ message: `phase ${phase.id} is ${phase.status}; only a ready phase can be handed off` })
            const parent = yield* ctx.session.get({ sessionID: invocation.sessionID }).pipe(Effect.mapError((error) => new ToolFailure({ message: message(error), error })))
            let ancestor = parent
            let depth = 0
            while (ancestor.parentID) {
              depth++
              ancestor = yield* ctx.session.get({ sessionID: ancestor.parentID }).pipe(Effect.mapError((error) => new ToolFailure({ message: message(error), error })))
            }
            if (depth >= 1) return yield* new ToolFailure({ message: "ULM operation handoffs cannot be nested beyond the upstream default subagent depth of 1" })
            const agent = yield* ctx.agent.get({ agentID: Agent.ID.make(input.agent) }).pipe(Effect.map((result) => result.data), Effect.mapError((error) => new ToolFailure({ message: message(error), error })))
            if (agent.mode === "primary") return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` })
            yield* ctx.permission.assert({
              action: "subagent",
              resources: [agent.id],
              save: [agent.id],
              sessionID: invocation.sessionID,
              agent: invocation.agent,
              source: { type: "tool", messageID: invocation.messageID, id: invocation.id },
            })
            const activeHandoff = record.handoffs.find((item) => item.phaseID === phase.id && (item.status === "offered" || item.status === "accepted"))
            const attempt = record.handoffs.filter((item) => item.phaseID === phase.id).length
            const childID = Session.ID.make(activeHandoff?.childID ?? `ses_ulm_${digest(`${record.id}:${input.phaseID}:${invocation.messageID}:${invocation.id}:${attempt}`).slice(0, 32)}`)
            const child = activeHandoff
              ? yield* ctx.session.get({ sessionID: childID }).pipe(Effect.mapError((error) => new ToolFailure({ message: message(error), error })))
              : yield* ctx.session.create({ id: childID, parentID: invocation.sessionID, title: `ULM: ${phase.title}`, agent: agent.id }).pipe(Effect.mapError((error) => new ToolFailure({ message: message(error), error })))
            yield* Effect.tryPromise({ try: () => store.bindSession(record.id, child.id), catch: (error) => new ToolFailure({ message: message(error), error }) })
            const priorHandoff = record.handoffs.find((item) => item.phaseID === phase.id && item.childID === child.id)
            if (!priorHandoff) yield* Effect.tryPromise({ try: () => engine.handoff(record.id, { phaseID: phase.id, childID: child.id }), catch: (error) => new ToolFailure({ message: message(error), error }) })
            if (!priorHandoff || priorHandoff.status === "offered") {
              yield* Effect.tryPromise({ try: () => engine.handoff(record.id, { phaseID: phase.id, childID: child.id, status: "accepted" }), catch: (error) => new ToolFailure({ message: message(error), error }) })
            }
            if (!activeHandoff) {
              const promptID = SessionMessage.ID.make(`msg_ulm_${digest(`${child.id}:${invocation.messageID}:${invocation.id}`).slice(0, 32)}`)
              yield* ctx.session.prompt({
                sessionID: child.id,
                id: promptID,
                delivery: "steer",
                text: `${input.task}\n\nOperation ${record.id}; phase ${phase.id}: ${phase.title}. Success criteria: ${phase.successCriteria.join("; ")}. Save any claimed outputs under .ulmcode/operations/${record.id}/subagents/${phase.id}/${child.id}/ and list exact relative artifact paths with evidence. Do not claim phase completion; the parent validates outputs.`,
              }).pipe(Effect.mapError((error) => new ToolFailure({ message: message(error), error })))
            }
            yield* ctx.session.wait({ sessionID: child.id }).pipe(
              Effect.mapError((error) => new ToolFailure({ message: message(error), error })),
              Effect.onInterrupt(() => Effect.gen(function* () {
                yield* ctx.session.interrupt({ sessionID: child.id }).pipe(Effect.mapError((error) => new ToolFailure({ message: message(error), error })))
                yield* Effect.tryPromise({ try: () => engine.handoff(record.id, { phaseID: phase.id, childID: child.id, status: "rejected" }), catch: (error) => new ToolFailure({ message: message(error), error }) })
              })),
            )
            const conversation = yield* ctx.session.context({ sessionID: child.id }).pipe(Effect.mapError((error) => new ToolFailure({ message: message(error), error })))
            const currentIdle = conversation.findLastIndex((item) => item.type === "idle")
            const previousIdle = conversation.findLastIndex((item, index) => item.type === "idle" && index < currentIdle)
            const summary = conversation.slice(previousIdle + 1, currentIdle).flatMap((item) => item.type === "assistant" ? item.content.filter((part) => part.type === "text").map((part) => part.text) : []).join("\n").slice(-8000)
            const idle = conversation[currentIdle]
            if (idle?.type !== "idle" || idle.outcome !== "succeeded") {
              yield* Effect.tryPromise({ try: () => engine.handoff(record.id, { phaseID: phase.id, childID: child.id, status: "rejected" }), catch: (error) => new ToolFailure({ message: message(error), error }) })
              return { output: { operationID: record.id, phaseID: phase.id, childID: child.id, status: idle?.type === "idle" ? idle.outcome : "unknown" }, content: `Child session ${child.id} did not complete successfully. The phase remains unverified.` }
            }
            yield* Effect.tryPromise({ try: () => engine.handoff(record.id, { phaseID: phase.id, childID: child.id, status: "completed" }), catch: (error) => new ToolFailure({ message: message(error), error }) })
            return { output: { operationID: record.id, phaseID: phase.id, childID: child.id, summary }, content: summary || `Child session ${child.id} completed without a final text summary. Validate phase artifacts before marking it complete.` }
        }),
      })
    }).pipe(Effect.orDie)

    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "session.execution.succeeded"),
      Stream.runForEach((event) => Effect.gen(function* () {
        const operation = yield* Effect.promise(() => store.forSession(event.data.sessionID))
        if (!operation || operation.status === "interrupted" || operation.goal.status !== "active" || !operation.goal.continuation.enabled) return
        const session = yield* ctx.session.get({ sessionID: event.data.sessionID })
        if (!operation.sessionIDs.includes(event.data.sessionID) || session.parentID !== undefined) return
        if (session.agent === Agent.ID.make("plan")) return
        const messages = yield* ctx.session.context({ sessionID: event.data.sessionID })
        const toolUsed = usedToolSincePreviousIdle(messages)
        const blockers = yield* Effect.tryPromise({
          try: () => completionBlockers(operation, { operationDirectory: store.directory(operation.id), requireFreshAudit: true }),
          catch: (error) => error,
        })
        const generated = yield* ctx.generate.text({
          model: session.model,
          prompt: `You are the hidden goal-checker for a ULM operation. Review only the durable record and deterministic gate result below. You have no tools and must not rely on the chat transcript. Decide whether the objective is complete. Reply with exactly one JSON object: {"verdict":"continue"|"done"|"needs_operator","reason":"brief reason"}. Use done only when there are no gate blockers. Use needs_operator for ambiguity, missing authorization, or blocked evidence.\nOperation record:\n${JSON.stringify(operation)}\nDeterministic completion blockers:\n${JSON.stringify(blockers)}`,
        })
        const idempotencyKey = `runtime.goal-review:${event.id}`
        const review = parseVerdict(generated.text) ?? { verdict: "needs_operator" as const, reason: "goal checker returned an invalid verdict" }
        const current = yield* Effect.promise(() => store.get(operation.id))
        if (!current || current.status === "interrupted" || current.goal.status !== "active") return
        const result = yield* Effect.tryPromise({
          try: () => engine.reviewGoal(operation.id, review.verdict, { reason: review.reason, toolUsed, idempotencyKey }),
          catch: (error) => error,
        })
        if (result.operation.status === "interrupted" || result.operation.goal.status !== "active") return
        if (result.continuation === "complete") return
        if (result.operation.goal.continuation.noToolStreak > result.operation.goal.continuation.maxNoToolTurns) {
          yield* ctx.session.synthetic({
            sessionID: event.data.sessionID,
            id: SessionMessage.ID.make(`msg_ulm_${digest(event.id).slice(0, 32)}`),
            text: `${NO_TOOL_LIMIT}. Operation ${operation.id} is saved with its latest goal-review blockers. Review the operation status before continuing.`,
            description: "ULM goal continuation limit notice",
            metadata: { operationID: operation.id, terminalEventID: event.id },
            resume: false,
          })
          return
        }
        if (result.continuation === "operator_required") return
        const text = review.verdict === "done" && result.blockers.length
          ? `The goal checker found these required artifact gates still open: ${result.blockers.join("; ")}. Continue the operation and produce or verify the missing artifacts before ending.`
          : `Continue the bound operation. Goal review: ${review.reason || review.verdict}. Use the operation record and artifacts as the source of truth.`
        yield* ctx.session.synthetic({
          sessionID: event.data.sessionID,
          id: SessionMessage.ID.make(`msg_ulm_limit_${digest(event.id).slice(0, 24)}`),
          text,
          description: "ULM artifact-gated goal continuation",
          metadata: { operationID: operation.id, terminalEventID: event.id, verdict: review.verdict },
          delivery: "steer",
        })
      }).pipe(Effect.catchCause((cause) => Effect.logError("ULM goal review failed", { cause })))),
    ).pipe(Effect.forkScoped)
  }),
})

export default RuntimePlugin
