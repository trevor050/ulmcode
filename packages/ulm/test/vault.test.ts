import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { listCredentials, materializeCredential, type CredentialHandle } from "../src/credentials.js"
import type { OperationRecord } from "../src/operation.js"
import { OperationStore } from "../src/store.js"
import { createVault } from "../src/vault.js"

function record(id: string, targets = ["http://127.0.0.1:8080", "http://127.0.0.1:8081"]): OperationRecord {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    objective: "Synthetic credential vault test",
    sessionIDs: [],
    scope: { targets, mode: "synthetic_lab" },
    goal: {
      status: "active",
      startedAt: now,
      continuation: { enabled: false, maxNoToolTurns: 0, noToolStreak: 0 },
      gates: ["plan_approved"],
    },
    executions: [],
    artifacts: [],
    handoffs: [],
  }
}

function formBody(token: string, extra: Record<string, string | string[]>) {
  const fields = new URLSearchParams({ token })
  for (const [key, values] of Object.entries(extra)) {
    for (const value of Array.isArray(values) ? values : [values]) fields.append(key, value)
  }
  return fields.toString()
}

describe("private operator credential vault form", () => {
  test("requires explicit review, rejects cross-operation tokens, and returns only reviewed opaque handles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ulmcode-vault-"))
    const store = new OperationStore({ workspaceRoot: path.join(root, "workspace") })
    const firstOperation = record("vault-lab-a")
    const secondOperation = record("vault-lab-b")
    await store.create(firstOperation)
    await store.create(secondOperation)
    const credentialsDir = path.join(root, "profile-private", "credentials")
    const vault = createVault({ store, credentialsDir })
    const base = "http://localhost:4310/api/operations"

    try {
      const form = await vault.handle(new Request(`${base}/${firstOperation.id}/vault`), firstOperation)
      expect(form?.status).toBe(200)
      expect(form?.headers.get("cache-control")).toContain("no-store")
      expect(form?.headers.get("content-security-policy")).toContain("form-action 'self'")
      expect(form?.headers.get("content-security-policy")).toContain("default-src 'none'")
      expect(form?.headers.get("referrer-policy")).toBe("same-origin")
      const markup = await form!.text()
      const token = markup.match(/name="token" value="([^"]+)"/)?.[1]
      expect(token).toBeDefined()
      expect(markup).toContain("Submit to agent")
      expect(markup).toContain("authorizedTarget")
      expect(markup).not.toContain("<script")

      const unreviewedBody = formBody(token!, {
        username: "fixture-user",
        password: "synthetic-secret-value",
        notes: "synthetic private note",
        reviewedBy: "fixture operator",
        authorizedTarget: "http://127.0.0.1:8080",
      })
      const unreviewed = await vault.handle(
        new Request(`${base}/${firstOperation.id}/vault/submit`, {
          method: "POST",
          headers: { Origin: "http://localhost:4310", "Content-Type": "application/x-www-form-urlencoded" },
          body: unreviewedBody,
        }),
        firstOperation,
      )
      expect(unreviewed?.status).toBe(400)
      expect(await listCredentials(store.directory(firstOperation.id), firstOperation.id)).toHaveLength(0)
      expect(await Bun.file(path.join(credentialsDir, firstOperation.id, "cred_missing.json")).exists()).toBe(false)

      const crossToken = markup.match(/name="token" value="([^"]+)"/)?.[1]!
      const crossOperation = await vault.handle(
        new Request(`${base}/${secondOperation.id}/vault/submit`, {
          method: "POST",
          headers: { Origin: "http://localhost:4310", "Content-Type": "application/x-www-form-urlencoded" },
          body: formBody(crossToken, {
            username: "fixture-user",
            password: "synthetic-secret-value",
            reviewedBy: "fixture operator",
            authorize: "yes",
            authorizedTarget: "http://127.0.0.1:8080",
          }),
        }),
        secondOperation,
      )
      expect(crossOperation?.status).toBe(403)
      expect(await listCredentials(store.directory(secondOperation.id), secondOperation.id)).toHaveLength(0)

      const freshForm = await vault.handle(new Request(`${base}/${firstOperation.id}/vault`), firstOperation)
      const freshToken = (await freshForm!.text()).match(/name="token" value="([^"]+)"/)?.[1]!
      const submitted = await vault.handle(
        new Request(`${base}/${firstOperation.id}/vault/submit`, {
          method: "POST",
          headers: { Origin: "http://localhost:4310", "Content-Type": "application/x-www-form-urlencoded" },
          body: formBody(freshToken, {
            username: "fixture-user",
            password: "synthetic-secret-value",
            notes: "synthetic private note",
            reviewedBy: "fixture operator",
            authorize: "yes",
            authorizedTarget: ["http://127.0.0.1:8080", "http://127.0.0.1:8081"],
          }),
        }),
        firstOperation,
      )
      expect(submitted?.status).toBe(201)
      const responseText = await submitted!.text()
      expect(responseText).toContain("Submitted to agent")
      expect(responseText).toContain("approved")
      const resultCredentialID = responseText.match(/<code>(cred_[a-zA-Z0-9_-]+)<\/code>/)?.[1]
      expect(resultCredentialID).toMatch(/^cred_[a-zA-Z0-9_-]+$/)
      const credentialID = resultCredentialID as CredentialHandle
      expect(responseText).not.toContain("fixture-user")
      expect(responseText).not.toContain("synthetic-secret-value")
      expect(responseText).not.toContain("synthetic private note")
      const entries = await listCredentials(store.directory(firstOperation.id), firstOperation.id)
      expect(entries).toHaveLength(1)
      expect(entries[0]?.status).toBe("approved")
      expect(entries[0]?.credentialID).toBe(credentialID)
      expect(entries[0]?.usePolicy.authorizedTargets).toEqual(["http://127.0.0.1:8080", "http://127.0.0.1:8081"])
      const indexText = await readFile(path.join(store.directory(firstOperation.id), "credentials", "index.json"), "utf8")
      expect(indexText).not.toContain("fixture-user")
      expect(indexText).not.toContain("synthetic-secret-value")
      expect(indexText).not.toContain("synthetic private note")
      const env = await materializeCredential({
        credentialsDir,
        operationRoot: store.directory(firstOperation.id),
        operationID: firstOperation.id,
        credentialID,
        target: "http://127.0.0.1:8080",
        executionID: "fixture-execution",
      })
      expect(Object.values(env)).toContain("synthetic-secret-value")
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects non-loopback and cross-origin requests without touching the credential store", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ulmcode-vault-origin-"))
    const store = new OperationStore({ workspaceRoot: path.join(root, "workspace") })
    const operation = record("vault-origin")
    await store.create(operation)
    const vault = createVault({ store, credentialsDir: path.join(root, "private") })
    const route = `/api/operations/${operation.id}/vault`
    try {
      const external = await vault.handle(new Request(`http://example.invalid${route}`), operation)
      expect(external?.status).toBe(403)
      const crossOrigin = await vault.handle(
        new Request(`http://localhost:4310${route}`, { headers: { Origin: "http://example.invalid" } }),
        operation,
      )
      expect(crossOrigin?.status).toBe(403)
      expect(await listCredentials(store.directory(operation.id), operation.id)).toHaveLength(0)
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
