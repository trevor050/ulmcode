import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import { writeOperationCheckpoint } from "../../src/ulm/artifact"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

async function expectStatus(response: Response, status: number) {
  if (response.status !== status) throw new Error(`Expected ${status}, got ${response.status}: ${await response.text()}`)
}

async function instanceWorktree(directory: string) {
  const response = await app().request("/path", { headers: { "x-opencode-directory": directory } })
  await expectStatus(response, 200)
  return ((await response.json()) as { worktree: string }).worktree
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

describe("ULM HttpApi", () => {
  test("serves operation dashboards through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const root = await instanceWorktree(tmp.path)
    await writeOperationCheckpoint(root, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
      riskLevel: "high",
      nextActions: ["Promote confirmed findings"],
    })

    const headers = { "x-opencode-directory": tmp.path }
    const listed = await app().request("/ulm/operation", { headers })
    await expectStatus(listed, 200)
    expect((await listed.json()) as unknown).toMatchObject([
      {
        operationID: "school",
        operation: { stage: "validation", status: "running", riskLevel: "high" },
      },
    ])

    const status = await app().request("/ulm/operation/school/status", { headers })
    await expectStatus(status, 200)
    expect((await status.json()) as unknown).toMatchObject({
      operationID: "school",
      operation: { objective: "Authorized school assessment", stage: "validation" },
    })
  })

  test("serves operation resume and audit payloads through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const root = await instanceWorktree(tmp.path)
    await writeOperationCheckpoint(root, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
    })

    const headers = { "x-opencode-directory": tmp.path }
    const resume = await app().request("/ulm/operation/school/resume?staleAfterMinutes=1", { headers })
    await expectStatus(resume, 200)
    expect((await resume.json()) as unknown).toMatchObject({
      operationID: "school",
      recommendedTools: expect.arrayContaining(["operation_status"]),
    })

    const audit = await app().request("/ulm/operation/school/audit?finalHandoff=true", { headers })
    await expectStatus(audit, 200)
    expect((await audit.json()) as unknown).toMatchObject({
      operationID: "school",
      ok: false,
      recommendedTools: expect.arrayContaining(["operation_plan"]),
    })
  })
})
