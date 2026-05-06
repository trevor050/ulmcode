import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { collectToolInventory, type ToolInventorySpec } from "@/ulm/tool-inventory"
import { tmpdir } from "../fixture/fixture"

const catalog: ToolInventorySpec[] = [
  {
    id: "fake-present",
    category: "recon",
    purpose: "present fixture",
    versionArgs: [["--version"]],
    install: [{ platform: "test", command: "install fake-present" }],
    fallbacks: ["manual"],
    highValue: true,
  },
  {
    id: "fake-missing",
    category: "web",
    purpose: "missing fixture",
    versionArgs: [["--version"]],
    install: [{ platform: "test", command: "install fake-missing" }],
    fallbacks: ["fake-present"],
    highValue: true,
  },
]

async function withPath<T>(dir: string, fn: () => Promise<T>) {
  const previous = process.env.PATH
  process.env.PATH = `${dir}${path.delimiter}${previous ?? ""}`
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
  }
}

async function writeExecutable(file: string, content: string) {
  await fs.writeFile(file, content)
  await fs.chmod(file, 0o755)
}

describe("ULM tool inventory", () => {
  test("detects present and missing tools and writes durable artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const bin = path.join(dir.path, "bin")
    await fs.mkdir(bin)
    await writeExecutable(path.join(bin, "fake-present"), "#!/bin/sh\necho fake-present 1.2.3\n")

    const result = await withPath(bin, () =>
      collectToolInventory(
        dir.path,
        { operationID: "School", includeVersions: true, probeTimeoutMs: 1000, writeArtifacts: true },
        { now: "2026-05-06T00:00:00.000Z", catalog },
      ),
    )

    expect(result.operationID).toBe("school")
    expect(result.record.counts.installed).toBe(1)
    expect(result.record.counts.missing).toBe(1)
    expect(result.record.counts.highValueMissing).toBe(1)
    expect(result.record.tools.find((tool) => tool.id === "fake-present")?.version).toBe("fake-present 1.2.3")
    expect(result.record.tools.find((tool) => tool.id === "fake-missing")?.installed).toBe(false)
    expect(result.json).toContain("tool-inventory.json")
    expect(result.markdown).toContain("tool-inventory.md")
    expect(await fs.readFile(result.markdown!, "utf8")).toContain("fake-missing")
  })

  test("timeboxes version probes without failing inventory collection", async () => {
    await using dir = await tmpdir({ git: true })
    const bin = path.join(dir.path, "bin")
    await fs.mkdir(bin)
    await writeExecutable(path.join(bin, "fake-present"), "#!/bin/sh\nsleep 1\necho late\n")

    const result = await withPath(bin, () =>
      collectToolInventory(
        dir.path,
        { operationID: "School", includeVersions: true, probeTimeoutMs: 20, writeArtifacts: false },
        { catalog },
      ),
    )

    const entry = result.record.tools.find((tool) => tool.id === "fake-present")
    expect(entry?.installed).toBe(true)
    expect(entry?.version).toBeUndefined()
  })

  test("skips version probes for fast presence-only inventory", async () => {
    await using dir = await tmpdir({ git: true })
    const bin = path.join(dir.path, "bin")
    await fs.mkdir(bin)
    await writeExecutable(path.join(bin, "fake-present"), "#!/bin/sh\necho should-not-run\n")

    const result = await withPath(bin, () =>
      collectToolInventory(
        dir.path,
        { operationID: "School", includeVersions: false, writeArtifacts: false },
        { catalog },
      ),
    )

    expect(result.record.tools.find((tool) => tool.id === "fake-present")?.installed).toBe(true)
    expect(result.record.tools.find((tool) => tool.id === "fake-present")?.version).toBeUndefined()
  })
})
