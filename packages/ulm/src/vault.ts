import { randomUUID } from "node:crypto"
import { reviewCredential, storeCredential } from "./credentials.js"
import { operationID, type OperationRecord } from "./operation.js"
import type { OperationStore } from "./store.js"

const TOKEN_TTL_MS = 15 * 60 * 1000
const MAX_FORM_BYTES = 16 * 1024

type VaultToken = { operationID: string; expiresAt: number }

/** A loopback-only, same-origin form for private operator credential submission. */
export function createVault(input: { store: Pick<OperationStore, "directory">; credentialsDir: string }) {
  const tokens = new Map<string, VaultToken>()

  return {
    async handle(request: Request, operation: OperationRecord): Promise<Response | undefined> {
      const route = new URL(request.url)
      const operationIDValue = operationID(operation.id)
      const basePath = `/api/operations/${encodeURIComponent(operationIDValue)}/vault`
      if (route.pathname !== basePath && route.pathname !== `${basePath}/submit`) return undefined
      if (route.search) return problem(request, route, "Vault links cannot include query parameters.", 400)
      if (!isLoopback(route) || (request.headers.has("origin") && request.headers.get("origin") !== route.origin))
        return problem(request, route, "Open this vault from its local, same-origin page.", 403)
      if (!operation.scope.targets.length) return problem(request, route, "This operation has no credential targets.", 409)

      if (request.method === "GET" && route.pathname === basePath) {
        const token = randomUUID()
        const now = Date.now()
        for (const [key, value] of tokens) if (value.expiresAt <= now) tokens.delete(key)
        tokens.set(token, { operationID: operationIDValue, expiresAt: now + TOKEN_TTL_MS })
        return html(renderForm({ action: `${basePath}/submit`, token, targets: operation.scope.targets }))
      }

      if (request.method !== "POST" || route.pathname !== `${basePath}/submit`)
        return problem(request, route, "This vault route does not support that method.", 405, { Allow: "GET, POST" })
      if (request.headers.get("origin") !== route.origin) return problem(request, route, "Submit this form from the local vault page.", 403)
      if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded")
        return problem(request, route, "Submit the local vault form to continue.", 415)

      const body = await request.text()
      if (new TextEncoder().encode(body).byteLength > MAX_FORM_BYTES) return problem(request, route, "The form is too large. Reload the vault and try again.", 413)
      const fields = new URLSearchParams(body)
      const allowedFields = new Set(["token", "username", "password", "notes", "reviewedBy", "authorize", "authorizedTarget"])
      if ([...fields.keys()].some((key) => !allowedFields.has(key))) return problem(request, route, "The form contains unsupported fields.", 400)
      const one = (key: string) => {
        const entries = fields.getAll(key)
        return entries.length === 1 ? entries[0] : entries.length === 0 ? "" : undefined
      }
      const token = one("token")
      const username = one("username")
      const password = one("password")
      const notes = one("notes")
      const reviewedBy = one("reviewedBy")?.trim()
      if (token === undefined || username === undefined || password === undefined || notes === undefined || !token)
        return problem(request, route, "Some form fields are missing or repeated.", 400)
      if (username.length > 500 || password.length > 4096 || notes.length > 4000 || !username.trim() && !password)
        return problem(request, route, "Enter a username or password within the field limits.", 400)
      if (fields.getAll("authorize").length !== 1 || fields.get("authorize") !== "yes" || !reviewedBy || reviewedBy.length > 120)
        return problem(request, route, "Add your reviewer name and confirm the authorization checkbox.", 400)

      const authorizedTargets = [...new Set(fields.getAll("authorizedTarget"))]
      if (!authorizedTargets.length || authorizedTargets.some((target) => !operation.scope.targets.includes(target)))
        return problem(request, route, "Select one or more targets in this operation's scope.", 400)

      const issued = tokens.get(token)
      if (!issued || issued.operationID !== operationIDValue || issued.expiresAt <= Date.now()) {
        tokens.delete(token)
        return problem(request, route, "This form expired or does not belong to this operation. Reload the vault.", 403)
      }
      tokens.delete(token)

      try {
        const credential = await storeCredential({
          credentialsDir: input.credentialsDir,
          operationRoot: input.store.directory(operationIDValue),
          operationID: operationIDValue,
          value: { username: username.trim() || undefined, password: password || undefined, notes: notes.trim() || undefined },
        })
        const reviewed = await reviewCredential({
          credentialsDir: input.credentialsDir,
          operationRoot: input.store.directory(operationIDValue),
          operationID: operationIDValue,
          credentialID: credential.credentialID,
          reviewedBy,
          authorizedTargets,
        })
        const result = { status: reviewed.status, credential: { credentialID: reviewed.credentialID, status: reviewed.status } }
        if (wantsJSON(request)) return json(result, 201)
        return html(renderSuccess({ ...result.credential, action: basePath }), 201)
      } catch {
        return problem(request, route, "Credentials could not be stored. No credential value was returned; reload and try again.", 500)
      }
    },
  }
}

function isLoopback(url: URL) {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
}

function responseHeaders(contentType: string, extra?: Record<string, string>) {
  const headers = new Headers(extra)
  headers.set("Content-Type", contentType)
  headers.set("Cache-Control", "no-store, max-age=0")
  headers.set("Pragma", "no-cache")
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Referrer-Policy", "same-origin")
  headers.set("Content-Security-Policy", "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'")
  return headers
}

function json(value: unknown, status: number, extra?: Record<string, string>) {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders("application/json; charset=utf-8", extra) })
}

function html(body: string, status = 200) {
  return new Response(body, { status, headers: responseHeaders("text/html; charset=utf-8") })
}

function wantsJSON(request: Request) {
  return request.headers.get("accept")?.split(",").some((type) => type.trim().split(";")[0] === "application/json") ?? false
}

function problem(request: Request, route: URL, message: string, status: number, extra?: Record<string, string>) {
  if (wantsJSON(request)) return json({ error: message }, status, extra)
  return new Response(renderMessage({ title: "Credentials were not submitted", message, action: route.pathname.split("/submit")[0] ?? route.pathname }), {
    status,
    headers: responseHeaders("text/html; charset=utf-8", extra),
  })
}

function renderForm(input: { action: string; token: string; targets: string[] }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Submit operation credentials</title><style>
:root{color-scheme:light dark;font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f5f7;color:#20242a}*{box-sizing:border-box}body{margin:0;padding:clamp(1rem,5vw,4rem) 1rem}main{max-width:44rem;margin:0 auto}.eyebrow{font-size:.78rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#526071}h1{font-size:clamp(1.7rem,4vw,2.25rem);line-height:1.15;letter-spacing:-.035em;margin:.5rem 0 1rem}.intro{color:#505b68;margin:0 0 1.5rem}.card{background:#fff;border:1px solid #d8dde4;border-radius:14px;padding:clamp(1.1rem,4vw,2rem);box-shadow:0 8px 24px #18283a0b}.section{border:0;border-top:1px solid #e2e6eb;margin:1.6rem 0 0;padding:1.4rem 0 0}.section legend{font-weight:700;padding:0 .5rem 0 0}.field{display:grid;gap:.4rem;margin:1rem 0}.field>span,.field label{font-weight:600}.field input,.field textarea{width:100%;border:1px solid #aeb7c2;border-radius:8px;padding:.75rem .8rem;background:#fff;color:#20242a;font:inherit}.field textarea{min-height:6rem;resize:vertical}.hint{font-size:.9rem;color:#5c6672;margin:.25rem 0 0}.targets{display:grid;gap:.6rem;margin:.8rem 0}.target{display:flex;gap:.65rem;align-items:flex-start;overflow-wrap:anywhere}.target input,.confirm input{width:1.15rem;height:1.15rem;flex:none;margin:.2rem 0 0;accent-color:#145ac7}.confirm{display:flex;gap:.7rem;align-items:flex-start;margin:1rem 0;font-weight:600}.actions{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-top:1.5rem}button{border:0;border-radius:8px;background:#145ac7;color:white;padding:.8rem 1.15rem;font:600 1rem system-ui;cursor:pointer}button:hover{background:#0d479f}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #5a9bff;outline-offset:2px}.privacy{font-size:.9rem;color:#505b68}.status{padding:1rem;border:1px solid #9ac8a7;border-radius:10px;background:#f0faf2;overflow-wrap:anywhere}.status code{font-size:.95rem}.error{padding:1rem;border:1px solid #d7a2a2;border-radius:10px;background:#fff5f5}a{color:#145ac7}@media(prefers-color-scheme:dark){:root{background:#11151a;color:#eef1f5}.card{background:#191f26;border-color:#39434f}.intro,.hint,.privacy,.eyebrow{color:#b1bdca}.section{border-color:#39434f}.field input,.field textarea{background:#101419;color:#eef1f5;border-color:#697686}.status{background:#102117;border-color:#3b7750}.error{background:#281718;border-color:#8c4b4b}a{color:#8dbaff}}
</style></head>
<body>
<main>
<p class="eyebrow">ULMCode · Private local vault</p>
<h1>Submit credentials to this operation</h1>
<p class="intro">Add an operator-provided account and approve exactly where it may be used. Secret values are stored privately and never returned to chat.</p>
<form class="card" method="post" action="${escapeHTML(input.action)}" accept-charset="UTF-8" autocomplete="off">
<input type="hidden" name="token" value="${escapeHTML(input.token)}">
<fieldset class="section"><legend>Credential details</legend>
<label class="field"><span>Username</span><input name="username" maxlength="500" autocomplete="off" spellcheck="false" aria-describedby="credential-hint"></label>
<label class="field"><span>Password</span><input name="password" type="password" maxlength="4096" autocomplete="new-password" spellcheck="false" aria-describedby="credential-hint"></label>
<label class="field"><span>Private notes <span class="hint">(optional)</span></span><textarea name="notes" maxlength="4000" autocomplete="off" spellcheck="false"></textarea></label>
<p class="hint" id="credential-hint">Enter a username, a password, or both. Values remain in the private local vault.</p>
</fieldset>
<fieldset class="section"><legend>Target authorization</legend><p class="hint">Select only the operation targets approved for this credential.</p><div class="targets">${input.targets.map((target) => `<label class="target"><input type="checkbox" name="authorizedTarget" value="${escapeHTML(target)}"> <span>${escapeHTML(target)}</span></label>`).join("\n")}</div></fieldset>
<fieldset class="section"><legend>Operator review</legend>
<label class="field"><span>Reviewed by</span><input name="reviewedBy" maxlength="120" autocomplete="off" spellcheck="false" required></label>
<label class="confirm"><input type="checkbox" name="authorize" value="yes" required> <span>I reviewed these credentials and authorize their use only for the selected targets.</span></label>
<p class="privacy">Submitting stores the private values and exposes only an opaque credential handle and review status to the agent.</p>
</fieldset>
<div class="actions"><button type="submit">Submit to agent</button><span class="hint">This local form expires after 15 minutes.</span></div>
</form>
</main>
</body>
</html>`
}

function renderSuccess(input: { credentialID: string; status: string; action: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Credentials submitted</title><style>
:root{font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f5f7;color:#20242a}body{margin:0;padding:clamp(1rem,5vw,4rem) 1rem}main{max-width:44rem;margin:0 auto}.card{background:#fff;border:1px solid #d8dde4;border-radius:14px;padding:clamp(1.1rem,4vw,2rem);box-shadow:0 8px 24px #18283a0b}.eyebrow{font-size:.78rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#526071}.status{padding:1rem;border:1px solid #9ac8a7;border-radius:10px;background:#f0faf2;overflow-wrap:anywhere}code{font-size:.95rem}a{color:#145ac7}:focus-visible{outline:3px solid #5a9bff;outline-offset:2px}@media(prefers-color-scheme:dark){:root{background:#11151a;color:#eef1f5}.card{background:#191f26;border-color:#39434f}.eyebrow{color:#b1bdca}.status{background:#102117;border-color:#3b7750}a{color:#8dbaff}}
</style></head><body><main><p class="eyebrow">ULMCode · Private local vault</p><section class="card" aria-labelledby="success-title"><h1 id="success-title">Submitted to agent</h1><p class="status" role="status">Credential review status: <strong>${escapeHTML(input.status)}</strong><br>Opaque handle: <code>${escapeHTML(input.credentialID)}</code></p><p>The private values were stored locally. Only this handle and review status are available to the agent.</p><p><a href="${escapeHTML(input.action)}">Return to vault</a></p></section></main></body></html>`
}

function renderMessage(input: { title: string; message: string; action: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(input.title)}</title><style>
:root{font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f5f7;color:#20242a}body{margin:0;padding:clamp(1rem,5vw,4rem) 1rem}main{max-width:44rem;margin:0 auto}.card{background:#fff;border:1px solid #d8dde4;border-radius:14px;padding:clamp(1.1rem,4vw,2rem)}.error{padding:1rem;border:1px solid #d7a2a2;border-radius:10px;background:#fff5f5}a{color:#145ac7}:focus-visible{outline:3px solid #5a9bff;outline-offset:2px}@media(prefers-color-scheme:dark){:root{background:#11151a;color:#eef1f5}.card{background:#191f26;border-color:#39434f}.error{background:#281718;border-color:#8c4b4b}a{color:#8dbaff}}
</style></head><body><main><section class="card" aria-labelledby="error-title"><h1 id="error-title">${escapeHTML(input.title)}</h1><p class="error" role="alert">${escapeHTML(input.message)}</p><p><a href="${escapeHTML(input.action)}">Reload the local vault</a></p></section></main></body></html>`
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
}

export * as Vault from "./vault.js"
