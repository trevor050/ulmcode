import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath } from "@/ulm/artifact"
import { buildWorkQueue, nextWorkUnits, requeueStaleWorkUnits, syncWorkQueueJobs } from "@/ulm/work-queue"
import { tmpdir } from "../fixture/fixture"

async function writeManifest(file: string, safety: "non_destructive" | "interactive_destructive" = "non_destructive") {
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        version: 1,
        lastReviewed: "2026-05-05",
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
          notes: [],
        },
        tools: [],
        commandProfiles: [
          {
            id: "service-inventory",
            tool: "nmap",
            safety,
            template: "nmap -sV -oA {outputPrefix} {target}",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/nmap.xml"],
          },
          {
            id: "http-discovery",
            tool: "httpx",
            safety: "non_destructive",
            template: "httpx -l {inputFile} -json -o {outputPrefix}.jsonl",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/httpx.jsonl"],
          },
          {
            id: "content-discovery",
            tool: "ffuf",
            safety: "non_destructive",
            template: "ffuf -u {url}/FUZZ -w {wordlist} -rate 25 -of json -o {outputPrefix}.json",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/ffuf.json"],
          },
        ],
      },
      null,
      2,
    ),
  )
}

describe("ULM work queue", () => {
  test("converts leads into deduped non-destructive command work units", async () => {
    await using dir = await tmpdir({ git: true })
    const root = operationPath(dir.path, "School")
    const manifest = path.join(dir.path, "manifest.json")
    await writeManifest(manifest)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "leads.json"),
      JSON.stringify(
        {
          operationID: "school",
          leads: [
            { id: "host-1", kind: "host", title: "Host up", host: "10.0.0.5", severity: "info", confidence: 0.8, summary: "up", evidence: [], source: { parser: "nmap-xml", path: "nmap.xml" } },
            { id: "host-duplicate", kind: "host", title: "Host up", host: "10.0.0.5", severity: "info", confidence: 0.8, summary: "up", evidence: [], source: { parser: "nmap-xml", path: "nmap.xml" } },
            { id: "url-1", kind: "url", title: "Portal", url: "https://portal.school.example", severity: "info", confidence: 0.8, summary: "web", evidence: [], source: { parser: "httpx-jsonl", path: "httpx.jsonl" } },
          ],
        },
        null,
        2,
      ),
    )

    const result = await buildWorkQueue(dir.path, { operationID: "School", manifestPath: manifest })

    expect(result.generated).toBe(3)
    expect(result.units.map((unit) => unit.profileID).sort()).toEqual([
      "content-discovery",
      "http-discovery",
      "service-inventory",
    ])
    expect(result.units.every((unit) => unit.safety === "non_destructive")).toBe(true)
    expect(await fs.readFile(result.inputFiles[0]!, "utf8")).toContain("10.0.0.5")

    const second = await buildWorkQueue(dir.path, { operationID: "School", manifestPath: manifest })
    expect(second.generated).toBe(0)
    expect(second.units).toHaveLength(3)
  })

  test("rejects destructive command profiles while building queue units", async () => {
    await using dir = await tmpdir({ git: true })
    const root = operationPath(dir.path, "School")
    const manifest = path.join(dir.path, "manifest.json")
    await writeManifest(manifest, "interactive_destructive")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "leads.json"),
      JSON.stringify({
        operationID: "school",
        leads: [
          { id: "host-1", kind: "host", title: "Host up", host: "10.0.0.5", severity: "info", confidence: 0.8, summary: "up", evidence: [], source: { parser: "nmap-xml", path: "nmap.xml" } },
        ],
      }),
    )

    await expect(buildWorkQueue(dir.path, { operationID: "School", manifestPath: manifest })).rejects.toThrow(
      "work queue only emits non_destructive",
    )
  })

  test("selects and claims queued units as command_supervise params", async () => {
    await using dir = await tmpdir({ git: true })
    const root = operationPath(dir.path, "School")
    const manifest = path.join(dir.path, "manifest.json")
    await writeManifest(manifest)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "leads.json"),
      JSON.stringify({
        operationID: "school",
        leads: [
          { id: "url-1", kind: "url", title: "Portal", url: "https://portal.school.example", severity: "info", confidence: 0.8, summary: "web", evidence: [], source: { parser: "httpx-jsonl", path: "httpx.jsonl" } },
        ],
      }),
    )
    await buildWorkQueue(dir.path, { operationID: "School", manifestPath: manifest })

    const selected = await nextWorkUnits(dir.path, { operationID: "School", laneID: "web_inventory", limit: 1, claim: true })

    expect(selected.units).toHaveLength(1)
    expect(selected.units[0]?.status).toBe("running")
    expect(selected.units[0]?.commandSupervise).toMatchObject({
      operationID: "school",
      laneID: "web_inventory",
      workUnitID: selected.units[0]?.id,
      dryRun: true,
    })
    const persisted = JSON.parse(await fs.readFile(selected.queuePath, "utf8"))
    expect(persisted.units.find((unit: { id: string }) => unit.id === selected.units[0]?.id)?.status).toBe("running")
  })

  test("syncs command_supervise jobs back into claimed work units", async () => {
    await using dir = await tmpdir({ git: true })
    const root = operationPath(dir.path, "School")
    const manifest = path.join(dir.path, "manifest.json")
    await writeManifest(manifest)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "leads.json"),
      JSON.stringify({
        operationID: "school",
        leads: [
          { id: "url-1", kind: "url", title: "Portal", url: "https://portal.school.example", severity: "info", confidence: 0.8, summary: "web", evidence: [], source: { parser: "httpx-jsonl", path: "httpx.jsonl" } },
        ],
      }),
    )
    await buildWorkQueue(dir.path, { operationID: "School", manifestPath: manifest })
    const selected = await nextWorkUnits(dir.path, { operationID: "School", laneID: "web_inventory", limit: 1, claim: true })
    const unit = selected.units[0]!

    const synced = await syncWorkQueueJobs(dir.path, {
      operationID: "School",
      backgroundJobs: [
        {
          id: "tool_123",
          type: "command_supervise",
          title: "ffuf",
          status: "completed",
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
          metadata: { operationID: "school", laneID: "web_inventory", workUnitID: unit.id },
        },
      ],
    })

    expect(synced.completedUnits).toEqual([unit.id])
    const persisted = JSON.parse(await fs.readFile(selected.queuePath, "utf8"))
    const updated = persisted.units.find((item: { id: string }) => item.id === unit.id)
    expect(updated?.status).toBe("complete")
    expect(updated?.jobID).toBe("tool_123")
  })

  test("requeues claimed units that never bind to a command job", async () => {
    await using dir = await tmpdir({ git: true })
    const root = operationPath(dir.path, "School")
    const manifest = path.join(dir.path, "manifest.json")
    await writeManifest(manifest)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "leads.json"),
      JSON.stringify({
        operationID: "school",
        leads: [
          { id: "url-1", kind: "url", title: "Portal", url: "https://portal.school.example", severity: "info", confidence: 0.8, summary: "web", evidence: [], source: { parser: "httpx-jsonl", path: "httpx.jsonl" } },
        ],
      }),
    )
    await buildWorkQueue(dir.path, { operationID: "School", manifestPath: manifest })
    const selected = await nextWorkUnits(dir.path, { operationID: "School", laneID: "web_inventory", limit: 1, claim: true })
    const unit = selected.units[0]!
    const queue = JSON.parse(await fs.readFile(selected.queuePath, "utf8"))
    queue.units[0].updatedAt = "2026-05-05T00:00:00.000Z"
    await fs.writeFile(selected.queuePath, JSON.stringify(queue, null, 2) + "\n")

    const result = await requeueStaleWorkUnits(dir.path, {
      operationID: "School",
      leaseSeconds: 60,
      now: new Date("2026-05-05T00:05:00.000Z"),
    })

    expect(result.requeuedUnits).toEqual([unit.id])
    const persisted = JSON.parse(await fs.readFile(selected.queuePath, "utf8"))
    expect(persisted.units[0]?.status).toBe("queued")
  })
})
