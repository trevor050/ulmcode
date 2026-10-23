import { realpath } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { OperationEngine } from "./engine"
import { LoopbackLabAdapter } from "./lab"
import { OperationStore, OperationConflictError } from "./store"
import { renderReport, lintReport } from "./report"
import { createVault } from "./vault"
import { listCredentials } from "./credentials"
import { CompositeExecutionAdapter, SupervisedCommandAdapter } from "./command"

const phase = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(500),
  dependsOn: z.array(z.string()).default([]),
  successCriteria: z.array(z.string().min(1)).min(1),
  restart: z.enum(["safe", "inspect_first", "never"]).default("inspect_first"),
  required: z.boolean().default(true),
  expectedArtifacts: z.array(z.string()).default([]),
  command: z.object({
    profileID: z.string().min(1).max(80),
    variables: z.record(z.string(), z.string()).default({}),
    credentialHandles: z.array(z.string()).optional(),
  }).strict().optional(),
}).strict()

export const planInput = z.object({
  version: z.number().int().positive(),
  assumptions: z.array(z.string()),
  successCriteria: z.array(z.string().min(1)).min(1),
  phases: z.array(phase).min(1).max(100),
  reporting: z.object({ required: z.boolean(), renderer: z.string().optional() }).strict(),
}).strict()

export const createInput = z.object({
  id: z.string().optional(),
  sessionID: z.string().min(1).max(160),
  objective: z.string().min(1).max(10_000),
  scope: z.object({
    targets: z.array(z.string().url()).min(1).max(20),
    mode: z.enum(["synthetic_lab", "authorized"]),
    authorizationRef: z.string().optional(),
  }).strict(),
  plan: planInput.optional(),
  goal: z.object({
    targetDurationMs: z.number().finite().nonnegative().optional(),
    continuation: z.object({
      enabled: z.boolean(),
      maxNoToolTurns: z.number().int().min(0).max(8),
    }).strict().optional(),
  }).strict().optional(),
}).strict()

export function localLabPlan() {
  return {
    version: 1,
    assumptions: ["Only the operator-started synthetic loopback lab is in scope.", "No real security target or external scan is authorized by this plan."],
    successCriteria: ["Collect real HTTP responses from the scoped synthetic lab", "Normalize evidence and generate a current, audited HTML/PDF package"],
    phases: [{
      id: "local-observation",
      title: "Collect synthetic lab observations",
      dependsOn: [],
      successCriteria: ["The scoped health and lab endpoints return structured evidence"],
      restart: "safe" as const,
      required: true,
      expectedArtifacts: [],
    }],
    reporting: { required: true, renderer: "chromium" },
  }
}

export function createHost(input: { workspaceRoot: string; chromiumPath?: string; credentialsDir?: string; commandCatalogPath?: string }) {
  const store = new OperationStore({ workspaceRoot: input.workspaceRoot })
  const adapter = input.commandCatalogPath
    ? new CompositeExecutionAdapter({ commands: new SupervisedCommandAdapter({ catalogPath: input.commandCatalogPath, credentialsDir: input.credentialsDir }) })
    : new LoopbackLabAdapter()
  const engine = new OperationEngine({ store, workspaceRoot: input.workspaceRoot, adapter })
  const vault = input.credentialsDir ? createVault({ store, credentialsDir: input.credentialsDir }) : undefined
  return { store, adapter, engine, vault, chromiumPath: input.chromiumPath }
}

export async function renderFinal(host: ReturnType<typeof createHost>, id: string) {
  const operation = await host.store.get(id)
  if (!operation) throw new Error("operation not found")
  const report = await renderReport({ operation, operationDirectory: host.store.directory(id), chromiumPath: host.chromiumPath })
  if (!report.pdfRendered) throw new Error("PDF rendering failed; inspect renderer availability")
  await host.engine.recordReport(id, { artifacts: report.artifacts, sourceRevision: operation.revision, sourceDigest: report.manifest.sourceDigest })
  const result = await host.engine.evaluateCompletion(id)
  return { operation: result.operation, report, result }
}

export function startServer(input: {
  workspaceRoot: string
  port?: number
  chromiumPath?: string
  allowedOrigin?: string
  credentialsDir?: string
  commandCatalogPath?: string
}) {
  const host = createHost(input)
  const allowedOrigin = input.allowedOrigin ?? "http://localhost:4444"
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: input.port ?? 4310,
    maxRequestBodySize: 128 * 1024,
    async fetch(request) {
      const origin = request.headers.get("origin")
      const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
      if (origin === allowedOrigin) {
        headers.set("Access-Control-Allow-Origin", origin)
        headers.set("Vary", "Origin")
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        headers.set("Access-Control-Allow-Headers", "Content-Type")
      }
      const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
      const url = new URL(request.url)
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return json({ error: { code: "host", message: "Local host required" } }, 403)
      if (origin && origin !== allowedOrigin && origin !== url.origin) return json({ error: { code: "origin", message: "Origin is not authorized" } }, 403)
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers })
      if (request.method !== "GET" && request.method !== "POST") return json({ error: { code: "method", message: "Method not allowed" } }, 405)
      const vaultSubmission = /^\/api\/operations\/[a-z0-9][a-z0-9_-]{0,79}\/vault\/submit$/.test(url.pathname)
      if (request.method === "POST" && !vaultSubmission && !request.headers.get("content-type")?.startsWith("application/json")) return json({ error: { code: "content_type", message: "Use application/json" } }, 415)
      try {
        if (request.method === "GET" && url.pathname === "/health") return json({ status: "ok", service: "ulmcode-operations", workspaceRoot: path.resolve(input.workspaceRoot), vaultEnabled: Boolean(host.vault) })
        if (url.pathname === "/api/operations") {
          if (request.method === "GET") return json({ operations: await host.store.list() })
          const parsed = createInput.parse(await request.json())
          if (parsed.scope.mode !== "synthetic_lab" && !input.commandCatalogPath) return json({ error: { code: "adapter", message: "Authorized command execution requires an explicitly configured trusted command catalog" } }, 400)
          return json({ operation: await host.engine.create({ ...parsed, plan: parsed.plan ?? localLabPlan() }) }, 201)
        }
        const match = /^\/api\/operations\/([a-z0-9][a-z0-9_-]{0,79})(?:\/(.*))?$/.exec(url.pathname)
        if (!match?.[1]) return json({ error: { code: "not_found", message: "Endpoint not found" } }, 404)
        const id = match[1]
        const action = match[2]
        const operation = await host.store.get(id)
        if (!operation) return json({ error: { code: "not_found", message: "Operation not found" } }, 404)
        if (action === "vault" || action === "vault/submit") {
          if (!host.vault) return json({ error: { code: "vault_unavailable", message: "Start the operation service with an explicit isolated profile root to enable its private credential vault" } }, 503)
          const response = await host.vault.handle(request, operation)
          if (response) return response
        }
        if (request.method === "GET" && action === "credentials") {
          const credentials = await listCredentials(host.store.directory(id), id)
          return json({ credentials, reviewStatus: {
            submitted: credentials.length > 0,
            reviewed: credentials.filter((credential) => credential.status === "approved").length,
            pending: credentials.filter((credential) => credential.status === "needs_review").length,
            requiresReauth: credentials.filter((credential) => credential.status === "reauth_required").length,
          } })
        }
        if (!action && request.method === "GET") return json({ operation })
        if (request.method === "GET" && action === "events") return json({ events: await host.store.events(id) })
        if (request.method === "GET" && action === "lint") return json(await lintReport({ operation, operationDirectory: host.store.directory(id) }))
        if (request.method === "GET" && action?.startsWith("artifacts/")) {
          const relative = decodeURIComponent(action.slice("artifacts/".length))
          const allowed = new Set([
            ...operation.artifacts.map((artifact) => artifact.path),
            ...(operation.evidence?.artifacts ?? []).map((artifact) => artifact.path),
          ])
          if (!allowed.has(relative)) return json({ error: { code: "artifact", message: "Artifact is not registered" } }, 404)
          const root = await realpath(host.store.directory(id))
          const target = await realpath(path.resolve(root, relative))
          const contained = path.relative(root, target)
          if (!contained || contained.startsWith("..") || path.isAbsolute(contained)) return json({ error: { code: "artifact", message: "Artifact path is invalid" } }, 400)
          // Rendered report HTML is untrusted content; isolate it from the operations origin.
          headers.set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
          return new Response(Bun.file(target), { headers })
        }
        if (request.method !== "POST") return json({ error: { code: "method", message: "Action requires POST" } }, 405)
        const body: unknown = await request.json()
        if (action === "plan") {
          return json({ operation: await host.engine.setPlan(id, planInput.parse(body)) })
        }
        if (action === "approve") {
          const parsed = z.object({ approvedBy: z.string().min(1).max(160) }).strict().parse(body)
          return json({ operation: await host.engine.approvePlan(id, parsed) })
        }
        if (action === "bind") {
          const parsed = z.object({ sessionID: z.string().min(1).max(160) }).strict().parse(body)
          return json({ operation: await host.store.bindSession(id, parsed.sessionID) })
        }
        if (action === "run") {
          z.object({}).strict().parse(body)
          const decision = await host.engine.tick(id)
          return json({ decision, operation: decision.operation })
        }
        if (action === "interrupt") {
          const parsed = z.object({ reason: z.string().max(1000).default("Operator interrupted local execution") }).strict().parse(body)
          return json({ operation: await host.engine.interrupt(id, parsed.reason) })
        }
        if (action === "recover") {
          z.object({}).strict().parse(body)
          const recovery = await host.engine.recover(id)
          return json({ recovery, operation: recovery.operation })
        }
        if (action === "normalize") {
          z.object({}).strict().parse(body)
          return json({ operation: await host.engine.normalizeEvidence(id) })
        }
        if (action === "review-goal") {
          const parsed = z.object({ verdict: z.enum(["continue", "done", "needs_operator"]), reason: z.string().max(1000).optional() }).strict().parse(body)
          const result = await host.engine.reviewGoal(id, parsed.verdict, { reason: parsed.reason })
          return json({ result, operation: result.operation })
        }
        if (action === "report") {
          z.object({}).strict().parse(body)
          return json(await renderFinal(host, id))
        }
        return json({ error: { code: "not_found", message: "Action not found" } }, 404)
      } catch (error) {
        if (error instanceof z.ZodError) return json({ error: { code: "validation", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") } }, 400)
        if (error instanceof OperationConflictError) return json({ error: { code: "conflict", message: error.message } }, 409)
        if (error instanceof SyntaxError) return json({ error: { code: "json", message: "Invalid JSON request" } }, 400)
        // Domain errors contain validation/context only. Credential APIs are kept off this public host.
        return json({ error: { code: "operation", message: error instanceof Error ? error.message : "Operation failed" } }, 400)
      }
    },
  })
  return { ...host, server, async close() { server.stop(true); await host.store.close() } }
}
