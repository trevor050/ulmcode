import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Discovery } from "../../src/skill/discovery"
import path from "path"

/**
 * These tests used to hit Cloudflare's public skills endpoint.
 * That makes the suite flaky (network, rate limits, DNS, captive portals).
 * Instead, we run a tiny local server that mimics the same .well-known/skills layout.
 */
let skillsBaseUrl: string
let server: ReturnType<typeof Bun.serve> | undefined

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)

      // Index describing available skills and their files.
      if (url.pathname === "/.well-known/skills/index.json") {
        return Response.json({
          skills: [
            {
              name: "agents-sdk",
              description: "fixture skill with references",
              files: ["SKILL.md", "references/extra.md"],
            },
            {
              name: "simple-skill",
              description: "fixture skill without references",
              files: ["SKILL.md"],
            },
          ],
        })
      }

      // Skill files
      if (url.pathname === "/.well-known/skills/agents-sdk/SKILL.md") {
        return new Response("name: agents-sdk\ndescription: fixture\n", { headers: { "content-type": "text/markdown" } })
      }
      if (url.pathname === "/.well-known/skills/agents-sdk/references/extra.md") {
        return new Response("# extra reference\n", { headers: { "content-type": "text/markdown" } })
      }
      if (url.pathname === "/.well-known/skills/simple-skill/SKILL.md") {
        return new Response("name: simple-skill\ndescription: fixture\n", { headers: { "content-type": "text/markdown" } })
      }

      // Default: 404
      return new Response("not found", { status: 404 })
    },
  })

  skillsBaseUrl = new URL("/.well-known/skills/", server.url.origin).href
})

afterAll(() => {
  server?.stop()
  server = undefined
})

describe("Discovery.pull", () => {
  test("downloads skills from well-known url", async () => {
    const dirs = await Discovery.pull(skillsBaseUrl)
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      expect(dir).toStartWith(Discovery.dir())
      const md = path.join(dir, "SKILL.md")
      expect(await Bun.file(md).exists()).toBe(true)
    }
  }, 30_000)

  test("url without trailing slash works", async () => {
    const dirs = await Discovery.pull(skillsBaseUrl.replace(/\/$/, ""))
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      const md = path.join(dir, "SKILL.md")
      expect(await Bun.file(md).exists()).toBe(true)
    }
  }, 30_000)

  test("returns empty array for invalid url", async () => {
    // Connection-refused should be handled and return [].
    const dirs = await Discovery.pull("http://127.0.0.1:1/.well-known/skills/")
    expect(dirs).toEqual([])
  })

  test("returns empty array for non-json response", async () => {
    using nonJson = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/skills/index.json") {
          return new Response("<html>nope</html>", { headers: { "content-type": "text/html" } })
        }
        return new Response("ok")
      },
    })
    const base = new URL("/.well-known/skills/", nonJson.url.origin).href
    const dirs = await Discovery.pull(base)
    expect(dirs).toEqual([])
  })

  test("downloads reference files alongside SKILL.md", async () => {
    const dirs = await Discovery.pull(skillsBaseUrl)
    // find a skill dir that should have reference files (e.g. agents-sdk)
    const agentsSdk = dirs.find((d) => d.endsWith("/agents-sdk"))
    if (agentsSdk) {
      const refs = path.join(agentsSdk, "references")
      expect(await Bun.file(path.join(agentsSdk, "SKILL.md")).exists()).toBe(true)
      // agents-sdk has reference files per the index
      const refDir = await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: refs, onlyFiles: true }))
      expect(refDir.length).toBeGreaterThan(0)
    }
  }, 30_000)

  test("caches downloaded files on second pull", async () => {
    // first pull to populate cache
    const first = await Discovery.pull(skillsBaseUrl)
    expect(first.length).toBeGreaterThan(0)

    // second pull should return same results from cache
    const second = await Discovery.pull(skillsBaseUrl)
    expect(second.length).toBe(first.length)
    expect(second.sort()).toEqual(first.sort())
  }, 60_000)
})
