import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Discovery } from "../../src/skill/discovery"
import { Filesystem } from "../../src/util/filesystem"
import { rm } from "fs/promises"
import path from "path"

let skillsBaseUrl: string
let server: ReturnType<typeof Bun.serve> | undefined
let downloadCount = 0

const fixturePath = path.join(import.meta.dir, "../fixture/skills")

beforeAll(async () => {
  await rm(Discovery.dir(), { recursive: true, force: true })
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)

      // route /.well-known/skills/* to the fixture directory
      if (url.pathname.startsWith("/.well-known/skills/")) {
        const filePath = url.pathname.replace("/.well-known/skills/", "")
        const fullPath = path.join(fixturePath, filePath)

        if (await Filesystem.exists(fullPath)) {
          if (!fullPath.endsWith("index.json")) {
            downloadCount++
          }
          return new Response(Bun.file(fullPath))
        }
      }

      return new Response("Not Found", { status: 404 })
    },
  })

  skillsBaseUrl = `http://localhost:${server.port}/.well-known/skills/`
})

afterAll(async () => {
  server?.stop()
  await rm(Discovery.dir(), { recursive: true, force: true })
})

describe("Discovery.pull", () => {
  test("downloads skills from well-known url", async () => {
    const dirs = await Discovery.pull(skillsBaseUrl)
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      expect(dir).toStartWith(Discovery.dir())
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
  })

  test("url without trailing slash works", async () => {
    const dirs = await Discovery.pull(skillsBaseUrl.replace(/\/$/, ""))
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
  })

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
    const agentsSdk = dirs.find((d) => d.endsWith(path.sep + "agents-sdk"))
    expect(agentsSdk).toBeDefined()
    if (agentsSdk) {
      const refs = path.join(agentsSdk, "references")
      expect(await Filesystem.exists(path.join(agentsSdk, "SKILL.md"))).toBe(true)
      // agents-sdk has reference files per the index
      const refDir = await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: refs, onlyFiles: true }))
      expect(refDir.length).toBeGreaterThan(0)
    }
  })

  test("caches downloaded files on second pull", async () => {
    // clear dir and downloadCount
    await rm(Discovery.dir(), { recursive: true, force: true })
    downloadCount = 0

    // first pull to populate cache
    const first = await Discovery.pull(skillsBaseUrl)
    expect(first.length).toBeGreaterThan(0)
    const firstCount = downloadCount
    expect(firstCount).toBeGreaterThan(0)

    // second pull should return same results from cache
    const second = await Discovery.pull(skillsBaseUrl)
    expect(second.length).toBe(first.length)
    expect(second.sort()).toEqual(first.sort())

    // second pull should NOT increment download count
    expect(downloadCount).toBe(firstCount)
  })
})
