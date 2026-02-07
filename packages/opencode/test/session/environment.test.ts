import path from "path"
import fs from "fs/promises"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { CyberEnvironment } from "../../src/session/environment"
import { tmpdir } from "../fixture/fixture"

describe("session.environment", () => {
  test("creates scaffold for cyber sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Pentest run" })
        const ensured = await CyberEnvironment.ensureSharedEnvironment({
          session,
          agentName: "pentest",
        })
        expect(ensured.environment).toBeDefined()
        const env = ensured.environment!
        expect(await Bun.file(path.join(env.root, "finding.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "handoff.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(env.root, "README.md")).exists()).toBe(true)
        const reports = await fs.stat(path.join(env.root, "reports"))
        expect(reports.isDirectory()).toBe(true)
        const visible = await fs.lstat(path.join(tmp.path, "engagements"))
        expect(visible.isDirectory()).toBe(true)
        const latest = await fs.lstat(path.join(tmp.path, "engagements", "latest"))
        expect(latest.isSymbolicLink()).toBe(true)
        const hidden = await fs.lstat(path.join(tmp.path, ".opencode", "engagements"))
        expect(hidden.isSymbolicLink() || hidden.isDirectory()).toBe(true)
      },
    })
  })

  test("does not create environment for non-cyber agents by default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Build run" })
        const ensured = await CyberEnvironment.ensureSharedEnvironment({
          session,
          agentName: "build",
        })
        expect(ensured.environment).toBeUndefined()
      },
    })
  })

  test("child sessions inherit parent environment and get subagent workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "Parent pentest" })
        const env = CyberEnvironment.create(parent)
        await Session.update(parent.id, (draft) => {
          draft.environment = env
        })
        await CyberEnvironment.ensureSharedScaffold({ environment: env, session: parent })

        const child = await Session.create({
          parentID: parent.id,
          title: "Child recon",
        })
        expect(child.environment?.root).toBe(env.root)

        await CyberEnvironment.ensureSubagentWorkspace({
          environment: child.environment!,
          session: child,
        })
        expect(await Bun.file(path.join(env.root, "agents", child.id, "results.md")).exists()).toBe(true)
      },
    })
  })

  test("normalizes legacy hidden environment roots to visible engagement roots", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Legacy env root" })
        const legacyRoot = path.join(tmp.path, ".opencode", "engagements", "legacy-eng")
        await fs.mkdir(legacyRoot, { recursive: true })
        await Session.update(session.id, (draft) => {
          draft.environment = {
            type: "cyber",
            root: legacyRoot,
            engagementID: "legacy-eng",
            created: Date.now(),
            scaffoldVersion: "v1",
            rootSessionID: session.id,
          }
        })

        const refreshed = await Session.get(session.id)
        const ensured = await CyberEnvironment.ensureSharedEnvironment({
          session: refreshed,
          force: true,
        })
        expect(ensured.changed).toBe(true)
        expect(ensured.environment?.root).toBe(path.join(tmp.path, "engagements", "legacy-eng"))
      },
    })
  })
})
