import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import {
  createOperationFromTemplate,
  normalizeToolOutput,
  updateOperationMemory,
  writeAssetGraph,
  writeAttackChain,
  writeBrowserEvidence,
  writeOperationAlert,
} from "@/ulm/operation-extras"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation extras", () => {
  test("writes operation-local memory", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await updateOperationMemory(dir.path, {
      operationID: "School",
      action: "append",
      section: "Scope",
      note: "Do not touch out-of-scope hosts after compaction.",
    })

    expect(result.operationID).toBe("school")
    expect(result.file).toEndWith("memory.md")
    expect(await fs.readFile(result.file, "utf8")).toContain("Do not touch out-of-scope hosts")
  })

  test("writes graph, chain, browser evidence, alert, and normalized output artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeAssetGraph(dir.path, {
      operationID: "School",
      nodes: [{ id: "app", kind: "route", label: "/login" }],
      edges: [{ from: "app", to: "finding-1", relationship: "supports", confidence: "medium" }],
    })
    const chain = await writeAttackChain(dir.path, {
      operationID: "School",
      title: "Weak login chain",
      summary: "A browser-observed login issue leads to exposed data.",
      steps: [{ title: "Reach login", assetID: "app" }],
    })
    const browser = await writeBrowserEvidence(dir.path, {
      operationID: "School",
      title: "Login page state",
      url: "https://example.test/login",
      authState: "unauthenticated",
      summary: "Login page rendered.",
    })
    const alert = await writeOperationAlert(dir.path, {
      operationID: "School",
      kind: "blocked",
      title: "Manual auth needed",
      message: "Authenticated review is blocked until credentials are provided.",
      sinks: ["console", "slack"],
    })
    const normalized = await normalizeToolOutput(dir.path, {
      operationID: "School",
      tool: "nmap",
      content: "80/tcp open http\nhttps://example.test/login\n",
    })

    expect(graph.nodes).toBe(1)
    expect(graph.edges).toBe(1)
    expect(chain.steps).toBe(1)
    expect(browser.evidenceID).toBe("login-page-state")
    expect(alert.sinks).toBe(2)
    expect(normalized.counts.ports).toBe(1)
    expect(normalized.counts.urls).toBe(1)
  })

  test("creates an operation from a template", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await createOperationFromTemplate(dir.path, {
      template: "single-url-web",
      objective: "Authorized single URL review",
      trustLevel: "unattended",
      scanProfile: "balanced",
      budgetUSD: 10,
    })

    expect(result.operationID).toMatch(/^[a-z]+-[a-z]+(-[a-z]+)?-[a-f0-9]{6}$/)
    expect(await fs.readFile(result.plan.json, "utf8")).toContain('"templateName": "single-url-web"')
    expect(await fs.readFile(result.graph.json, "utf8")).toContain('"trustLevel": "unattended"')
    expect(await fs.readFile(result.outline.file, "utf8")).toContain("Coverage, Browser Evidence, and Testing Limits")
    expect(await fs.readFile(result.memory, "utf8")).toContain("Started from single-url-web")
  })
})
