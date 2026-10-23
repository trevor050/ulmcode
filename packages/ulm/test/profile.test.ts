import { describe, expect, test } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { applyMigration, planMigration } from "../src/migration.js"
import {
  listCredentials,
  materializeCredential,
  reauthorizeCredential,
  reviewCredential,
  storeCredential,
} from "../src/credentials.js"
import { resolveProfilePaths, runtimeEnv } from "../src/profile.js"
import { OperationStore } from "../src/store.js"
import type { OperationRecord } from "../src/operation.js"

describe("ULMCode profile", () => {
  test("resolves one isolated runtime tree and strips inherited auth and config overrides", () => {
    const paths = resolveProfilePaths({ home: "/tmp/home", root: "/tmp/synthetic-profile" })
    const env = runtimeEnv(
      {
        XDG_DATA_HOME: "/home/user/.local/share",
        OPENCODE_AUTH_CONTENT: "synthetic-secret",
        OPENCODE_CONFIG_CONTENT: "{}",
        OPENAI_API_KEY: "synthetic-key",
        OPENAI_BASE_URL: "https://metered.invalid",
      },
      paths,
    )

    expect(env.XDG_DATA_HOME).toBe("/tmp/synthetic-profile/xdg/data")
    expect(env.XDG_CONFIG_HOME).toBe("/tmp/synthetic-profile/xdg/config")
    expect(env.XDG_STATE_HOME).toBe("/tmp/synthetic-profile/xdg/state")
    expect(env.XDG_CACHE_HOME).toBe("/tmp/synthetic-profile/xdg/cache")
    expect(env.OPENCODE_CONFIG_DIR).toBe("/tmp/synthetic-profile/config")
    expect(env.OPENCODE_CONFIG).toBe("/tmp/synthetic-profile/config/opencode.json")
    expect(env.OPENCODE_DB).toBe("ulmcode.db")
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1")
    expect(env.OPENCODE_CONFIG_GLOBAL_DISABLE).toBe("1")
    expect(env.OPENCODE_AUTH_CONTENT).toBeUndefined()
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.OPENAI_BASE_URL).toBeUndefined()
  })

  test("pins ULM to OpenAI, uses the requested product routes, and asks for plan approval", async () => {
    const config = await Bun.file(path.resolve(import.meta.dir, "../../../tools/ulmcode/profile.json")).json()
    expect(config.model).toBe("openai/gpt-5.5#high")
    expect(config.agents.recon.model).toBe("openai/gpt-5.4-mini-fast")
    expect(config.agents.evidence.model).toBe("openai/gpt-5.4-mini-fast")
    expect(config.agents.report_writer.model).toBe("openai/gpt-5.5#high")
    expect(config.policies).toEqual([
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "openai", effect: "allow" },
    ])
    expect(config.permissions).toContainEqual({ action: "operation_approve_plan", resource: "*", effect: "ask" })
    expect(config.permissions).toContainEqual({ action: "operation_credentials", resource: "*", effect: "ask" })
  })

  test("keeps public credential handles redacted and requires reviewed target scope before materialization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ulmcode-credentials-"))
    try {
      const operationRoot = path.join(root, "workspace", ".ulmcode", "operations", "lab-one")
      const credentialsDir = path.join(root, "profile", "private", "credentials")
      const stored = await storeCredential({
        operationRoot,
        credentialsDir,
        operationID: "lab-one",
        value: {
          label: "Synthetic account",
          username: "fixture-user",
          password: "fixture-secret",
          notes: "synthetic-only note",
        },
      })
      const indexFile = path.join(operationRoot, "credentials", "index.json")
      const index = await Bun.file(indexFile).text()
      expect(index).toContain(stored.credentialID)
      expect(index).not.toContain("fixture-user")
      expect(index).not.toContain("fixture-secret")
      expect(index).not.toContain("synthetic-only note")
      expect((await stat(path.join(credentialsDir, "lab-one", `${stored.credentialID}.json`))).mode & 0o777).toBe(0o600)
      await expect(
        materializeCredential({
          operationRoot,
          credentialsDir,
          operationID: "lab-one",
          credentialID: stored.credentialID,
          target: "school.example",
          executionID: "exec-1",
        }),
      ).rejects.toThrow("credential is not reviewed for this target")

      await reviewCredential({
        operationRoot,
        credentialsDir,
        operationID: "lab-one",
        credentialID: stored.credentialID,
        reviewedBy: "synthetic-operator",
        authorizedTargets: ["school.example"],
      })
      await expect(
        materializeCredential({
          operationRoot,
          credentialsDir,
          operationID: "lab-one",
          credentialID: stored.credentialID,
          target: "other.example",
          executionID: "exec-1",
        }),
      ).rejects.toThrow("credential is not reviewed for this target")
      const env = await materializeCredential({
        operationRoot,
        credentialsDir,
        operationID: "lab-one",
        credentialID: stored.credentialID,
        target: "school.example",
        executionID: "exec-1",
      })
      expect(Object.values(env)).toContain("fixture-secret")
      const usage = await Bun.file(path.join(operationRoot, "credentials", "usage.jsonl")).text()
      expect(usage).toContain(stored.credentialID)
      expect(usage).toContain("school.example")
      expect(usage).toContain("exec-1")
      expect(usage).not.toContain("fixture-secret")
      expect((await listCredentials(operationRoot, "lab-one"))[0]?.status).toBe("approved")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("serializes credential index updates from concurrent processes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ulmcode-credential-race-"))
    try {
      const operationRoot = path.join(root, "workspace", ".ulmcode", "operations", "race-lab")
      const credentialsDir = path.join(root, "profile", "private", "credentials")
      const worker = `
        import { storeCredential } from ${JSON.stringify(new URL("../src/credentials.ts", import.meta.url).href)}
        await storeCredential({
          operationRoot: process.env.RACE_OPERATION_ROOT,
          credentialsDir: process.env.RACE_CREDENTIALS_DIR,
          operationID: "race-lab",
          value: { username: process.env.RACE_CREDENTIAL_ID, password: "fixture-race-secret" },
        })
      `
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
            const child = spawn(process.execPath, ["-e", worker], {
              env: {
                ...process.env,
                RACE_OPERATION_ROOT: operationRoot,
                RACE_CREDENTIALS_DIR: credentialsDir,
                RACE_CREDENTIAL_ID: `fixture-user-${index}`,
              },
              stdio: ["ignore", "ignore", "pipe"],
            })
            let stderr = ""
            child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
            child.once("error", reject)
            child.once("exit", (code) => resolve({ code, stderr }))
          }),
        ),
      )
      expect(results.every((result) => result.code === 0), results.map((result) => result.stderr).join("\n")).toBe(true)
      expect(await listCredentials(operationRoot, "race-lab")).toHaveLength(8)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("migrates synthetic operations byte-for-byte, quarantines legacy credentials, and is idempotent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ulmcode-migration-"))
    try {
      const sourceOperationsRoot = path.join(root, "source", "operations")
      const sourceStorageRoot = path.join(root, "source", "data")
      const targetWorkspaceRoot = path.join(root, "target", "workspace")
      const targetOperationsRoot = path.join(targetWorkspaceRoot, ".ulmcode", "operations")
      const targetCredentialsDir = path.join(root, "target", "private", "credentials")
      const sourceOperationRoot = path.join(sourceOperationsRoot, "lab-one")
      const malformedOperationRoot = path.join(sourceOperationsRoot, "broken-one")
      const sourceIndex = Buffer.from(
        JSON.stringify(
          {
            operationID: "lab-one",
            credentials: [
              { credentialID: "teacher", label: "Fixture", username: "fixture-user", notes: "private-note" },
              { credentialID: "user.name", label: "Collision A", notes: "collision-note-a" },
              { credentialID: "user-name", label: "Collision B", notes: "collision-note-b" },
            ],
          },
          null,
          2,
        ) + "\n",
      )
      const operationBytes = Buffer.from(
        JSON.stringify(
          {
            operationID: "lab-one",
            objective: "Synthetic authorized assessment",
            stage: "recon",
            status: "running",
            summary: "Synthetic operation imported for operator review",
            nextActions: ["Review imported scope"],
            blockers: [],
            riskLevel: "medium",
            activeTasks: ["legacy-task-a"],
            evidence: [{ id: "fixture-evidence", path: "evidence/sample.txt", summary: "Synthetic evidence reference" }],
            time: { created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T01:00:00.000Z" },
          },
          null,
          2,
        ) + "\n",
      )
      const artifactBytes = Buffer.from("Synthetic evidence without credential material.\n")
      const credentialAssignmentBytes = Buffer.from(`password=${randomBytes(24).toString("hex")}\n`)
      const planBytes = Buffer.from(
        JSON.stringify(
          {
            operationID: "lab-one",
            phases: [
              {
                stage: "recon",
                objective: "Review synthetic scope",
                actions: ["Review only"],
                successCriteria: ["Operator confirms scope"],
                subagents: [],
                noSubagents: [],
              },
            ],
            assumptions: ["Synthetic fixture"],
            planningApproval: { status: "approved", approver: "synthetic-operator", approvedAt: "2026-01-01T00:30:00.000Z" },
            reportingCloseout: ["Render report"],
          },
          null,
          2,
        ) + "\n",
      )
      const goalBytes = Buffer.from(
        JSON.stringify({
          operationID: "lab-one",
          objective: "Synthetic authorized assessment",
          status: "active",
          targetDurationHours: 2,
          completionPolicy: {
            requiresOperationAudit: true,
            requiresRuntimeSummary: true,
            requiresReportRender: true,
            requiresStageGate: "handoff",
          },
          continuation: {
            enabled: true,
            idleMinutesBeforeReview: 10,
            maxNoToolContinuationTurns: 1,
            turnEndReview: true,
            injectPlanMaxChars: 12_000,
            operatorFallbackTimeoutSeconds: 300,
            operatorFallbackEnabled: true,
            maxRepeatedOperatorTimeoutsPerKind: 2,
            operatorFallbackSuppressionWindowSeconds: 600,
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:30:00.000Z",
        }) + "\n",
      )
      const teacherSecret = Buffer.from('{"operationID":"lab-one","credentialID":"teacher","username":"fixture-user","password":"fixture-secret"}\n')
      await mkdir(path.join(sourceOperationRoot, "credentials"), { recursive: true })
      await mkdir(path.join(sourceOperationRoot, "evidence"), { recursive: true })
      await mkdir(path.join(sourceOperationRoot, "plans"), { recursive: true })
      await mkdir(path.join(sourceOperationRoot, "goals"), { recursive: true })
      await mkdir(malformedOperationRoot, { recursive: true })
      await mkdir(path.join(sourceStorageRoot, "storage", "ulm", "credential", "lab-one"), { recursive: true })
      await writeFile(path.join(sourceOperationRoot, "operation.json"), operationBytes)
      await writeFile(path.join(sourceOperationRoot, "evidence", "sample.txt"), artifactBytes)
      await writeFile(path.join(sourceOperationRoot, "evidence", "credential-note.txt"), credentialAssignmentBytes)
      await writeFile(path.join(sourceOperationRoot, "plans", "operation-plan.json"), planBytes)
      await writeFile(path.join(sourceOperationRoot, "goals", "operation-goal.json"), goalBytes)
      await writeFile(path.join(sourceOperationRoot, "credentials", "index.json"), sourceIndex)
      await writeFile(path.join(malformedOperationRoot, "operation.json"), '{"operationID":"wrong-id"}\n')
      await writeFile(path.join(malformedOperationRoot, "unknown.txt"), "archive-only malformed operation\n")
      await writeFile(
        path.join(sourceStorageRoot, "storage", "ulm", "credential", "lab-one", "teacher.json"),
        teacherSecret,
        { mode: 0o600 },
      )
      await writeFile(
        path.join(sourceStorageRoot, "storage", "ulm", "credential", "lab-one", "user-name.json"),
        '{"password":"ambiguous-secret"}\n',
        { mode: 0o600 },
      )

      const input = { sourceOperationsRoot, sourceStorageRoot, targetOperationsRoot, targetWorkspaceRoot, targetCredentialsDir }
      const plan = await planMigration(input)
      expect(plan.operationCount).toBe(2)
      expect(plan.credentialCount).toBe(3)
      expect(plan.reauthenticationCount).toBe(2)
      expect(plan.importableOperationCount).toBe(1)
      expect(plan.quarantinedOperationCount).toBe(1)
      const teacherSecretPath = path.join(sourceStorageRoot, "storage", "ulm", "credential", "lab-one", "teacher.json")
      await writeFile(teacherSecretPath, '{"password":"changed-after-plan"}\n', { mode: 0o600 })
      await expect(applyMigration(plan)).rejects.toThrow("migration source changed after planning")
      await writeFile(teacherSecretPath, teacherSecret, { mode: 0o600 })
      const first = await applyMigration(plan)
      const second = await applyMigration(plan)
      expect(first.planID).toBe(second.planID)
      expect(first.importedOperations).toBe(1)
      expect(first.quarantinedOperations).toBe(1)
      expect(first.quarantined[0]?.reason).toContain("malformed")
      expect(await readFile(path.join(targetOperationsRoot, "lab-one", "evidence", "sample.txt"))).toEqual(artifactBytes)
      await expect(readFile(path.join(targetOperationsRoot, "lab-one", "evidence", "credential-note.txt"))).rejects.toThrow()
      expect(await readFile(path.join(sourceOperationRoot, "credentials", "index.json"))).toEqual(sourceIndex)
      expect(await readFile(path.join(targetCredentialsDir, "lab-one", "quarantine", "legacy-index.json"))).toEqual(
        sourceIndex,
      )
      const legacyOperationArchive = path.join(
        targetCredentialsDir,
        "lab-one",
        "quarantine",
        "legacy-operation",
        `${createHash("sha256").update("operation.json").digest("hex")}.bin`,
      )
      expect(await readFile(legacyOperationArchive)).toEqual(operationBytes)

      const migratedStore = new OperationStore({ workspaceRoot: targetWorkspaceRoot })
      const migratedOperation = await migratedStore.get("lab-one")
      expect(migratedOperation?.status).toBe("blocked")
      expect(migratedOperation?.objective).toBe("Synthetic authorized assessment")
      expect(migratedOperation?.plan?.approvedAt).toBeUndefined()
      expect(migratedOperation?.goal.continuation.enabled).toBe(false)
      expect(migratedOperation?.goal.startedAt).toBe("2026-01-01T00:00:00.000Z")
      expect(migratedOperation?.goal.targetDurationMs).toBe(2 * 60 * 60 * 1000)
      expect(migratedOperation?.evidence?.claims[0]?.id).toBe("fixture-evidence")
      await migratedStore.close()

      const publicIndex = await Bun.file(path.join(targetOperationsRoot, "lab-one", "credentials", "index.json")).text()
      expect(publicIndex).not.toContain("fixture-user")
      expect(publicIndex).not.toContain("private-note")
      expect(publicIndex).not.toContain("fixture-secret")
      expect(publicIndex).not.toContain("ambiguous-secret")
      const credentials = await listCredentials(path.join(targetOperationsRoot, "lab-one"), "lab-one")
      expect(credentials.map((item) => item.credentialID)).toHaveLength(3)
      expect(new Set(credentials.map((item) => item.credentialID)).size).toBe(3)
      expect(credentials.filter((item) => item.status === "reauth_required")).toHaveLength(2)
      expect((await stat(path.join(targetCredentialsDir, "lab-one", "quarantine", "legacy-index.json"))).mode & 0o777).toBe(
        0o600,
      )

      const migratedTeacher = credentials.find((item) => item.status === "needs_review")
      expect(migratedTeacher).toBeDefined()
      if (!migratedTeacher) throw new Error("expected migrated fixture credential")
      const authorized = await reviewCredential({
        operationRoot: path.join(targetOperationsRoot, "lab-one"),
        credentialsDir: targetCredentialsDir,
        operationID: "lab-one",
        credentialID: migratedTeacher.credentialID,
        reviewedBy: "synthetic-operator",
        authorizedTargets: ["school.example"],
      })
      expect(authorized.status).toBe("approved")
      const missingSecret = credentials.find((item) => item.status === "reauth_required")
      expect(missingSecret).toBeDefined()
      if (!missingSecret) throw new Error("expected ambiguous fixture credential")
      const restored = await reauthorizeCredential({
        operationRoot: path.join(targetOperationsRoot, "lab-one"),
        credentialsDir: targetCredentialsDir,
        operationID: "lab-one",
        credentialID: missingSecret.credentialID,
        value: { username: "new-fixture-user", password: "new-fixture-secret" },
      })
      expect(restored.status).toBe("needs_review")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("preflights canonical operation conflicts before copying any public artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ulmcode-migration-conflict-"))
    const sourceOperationsRoot = path.join(root, "source", "operations")
    const sourceStorageRoot = path.join(root, "source", "storage")
    const targetWorkspaceRoot = path.join(root, "target", "workspace")
    const targetOperationsRoot = path.join(targetWorkspaceRoot, ".ulmcode", "operations")
    const targetCredentialsDir = path.join(root, "target", "private", "credentials")
    const sourceOperationRoot = path.join(sourceOperationsRoot, "migration-conflict")
    const now = "2026-02-01T00:00:00.000Z"
    const artifactPath = path.join(targetOperationsRoot, "migration-conflict", "evidence", "new.txt")
    try {
      await mkdir(path.join(sourceOperationRoot, "evidence"), { recursive: true })
      await writeFile(
        path.join(sourceOperationRoot, "operation.json"),
        JSON.stringify({
          operationID: "migration-conflict",
          objective: "Source objective",
          status: "running",
          time: { created: now, updated: now },
        }) + "\n",
      )
      await writeFile(path.join(sourceOperationRoot, "evidence", "new.txt"), "Synthetic evidence that must not be copied.\n")
      const input = { sourceOperationsRoot, sourceStorageRoot, targetOperationsRoot, targetWorkspaceRoot, targetCredentialsDir }
      const plan = await planMigration(input)
      const targetStore = new OperationStore({ workspaceRoot: targetWorkspaceRoot })
      const existing: OperationRecord = {
        schemaVersion: 1,
        id: "migration-conflict",
        revision: 0,
        createdAt: now,
        updatedAt: now,
        status: "draft",
        objective: "Different target objective",
        sessionIDs: [],
        scope: { targets: [], mode: "synthetic_lab" },
        goal: { status: "active", startedAt: now, continuation: { enabled: false, maxNoToolTurns: 0, noToolStreak: 0 }, gates: [] },
        executions: [],
        artifacts: [],
        handoffs: [],
      }
      await targetStore.create(existing)
      await targetStore.close()

      await expect(applyMigration(plan)).rejects.toThrow("migration destination contains a different operation")
      await expect(readFile(artifactPath)).rejects.toThrow()
      await expect(readFile(path.join(targetCredentialsDir, "migration-conflict", "quarantine", "legacy-operation", "manifest.json"))).rejects.toThrow()

      const matchingWorkspaceRoot = path.join(root, "target", "matching-workspace")
      const matchingOperationsRoot = path.join(matchingWorkspaceRoot, ".ulmcode", "operations")
      const matchingCredentialsDir = path.join(root, "target", "matching-private", "credentials")
      const matchingInput = {
        sourceOperationsRoot,
        sourceStorageRoot,
        targetOperationsRoot: matchingOperationsRoot,
        targetWorkspaceRoot: matchingWorkspaceRoot,
        targetCredentialsDir: matchingCredentialsDir,
      }
      const matchingPlan = await planMigration(matchingInput)
      await applyMigration(matchingPlan)
      const matchingArtifact = path.join(matchingOperationsRoot, "migration-conflict", "evidence", "new.txt")
      const existingArtifact = Buffer.from("Pre-existing target evidence must remain untouched.\n")
      await writeFile(matchingArtifact, existingArtifact)
      await expect(applyMigration(matchingPlan)).rejects.toThrow("migration destination contains different data")
      expect(await readFile(matchingArtifact)).toEqual(existingArtifact)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("quarantines credential-shaped assignments without relying on a credential index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ulmcode-migration-patterns-"))
    const sourceOperationsRoot = path.join(root, "source", "operations")
    const sourceStorageRoot = path.join(root, "source", "storage")
    const targetWorkspaceRoot = path.join(root, "target", "workspace")
    const targetOperationsRoot = path.join(targetWorkspaceRoot, ".ulmcode", "operations")
    const targetCredentialsDir = path.join(root, "target", "private", "credentials")
    const sourceOperationRoot = path.join(sourceOperationsRoot, "pattern-lab")
    const now = "2026-03-01T00:00:00.000Z"
    const passwordCanary = randomBytes(24).toString("base64url")
    const bearerCanary = randomBytes(24).toString("base64url")
    const leakBytes = Buffer.from(`password=${passwordCanary}\nAuthorization: Bearer ${bearerCanary}\n`)
    try {
      await mkdir(path.join(sourceOperationRoot, "evidence"), { recursive: true })
      await writeFile(
        path.join(sourceOperationRoot, "operation.json"),
        JSON.stringify({ operationID: "pattern-lab", objective: "Synthetic migration scan", status: "running", time: { created: now, updated: now } }) + "\n",
      )
      await writeFile(path.join(sourceOperationRoot, "evidence", "leak.txt"), leakBytes)
      const plan = await planMigration({ sourceOperationsRoot, sourceStorageRoot, targetOperationsRoot, targetWorkspaceRoot, targetCredentialsDir })
      expect(plan.credentialCount).toBe(0)
      expect(plan.importableOperationCount).toBe(1)

      const result = await applyMigration(plan)
      expect(result.importedOperations).toBe(1)
      await expect(readFile(path.join(targetOperationsRoot, "pattern-lab", "evidence", "leak.txt"))).rejects.toThrow()
      const manifest = await Bun.file(path.join(targetCredentialsDir, "pattern-lab", "quarantine", "legacy-operation", "manifest.json")).json()
      expect(manifest.files).toContainEqual(
        expect.objectContaining({ path: "evidence/leak.txt", disposition: "quarantined" }),
      )
      const archiveFile = path.join(
        targetCredentialsDir,
        "pattern-lab",
        "quarantine",
        "legacy-operation",
        `${createHash("sha256").update("evidence/leak.txt").digest("hex")}.bin`,
      )
      expect(await readFile(archiveFile)).toEqual(leakBytes)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
