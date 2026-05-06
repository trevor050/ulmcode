import { describe, expect, test } from "bun:test"
import { commandRestartArgs, taskRestartArgs } from "@/tool/task_restart_args"

describe("ULM background restart args", () => {
  test("preserves model lane restart metadata", () => {
    const args = taskRestartArgs({
      id: "task_1",
      type: "task",
      title: "Recon lane",
      status: "stale",
      startedAt: Date.now(),
      metadata: {
        operationID: "school",
        laneID: "recon",
        description: "Recon lane",
        prompt: "resume recon",
        subagent_type: "recon",
        modelRoute: "opencode-go/default",
      },
    })

    expect(args).toMatchObject({
      task_id: "task_1",
      operationID: "school",
      laneID: "recon",
      modelRoute: "opencode-go/default",
      prompt: "resume recon",
      subagent_type: "recon",
    })
  })

  test("preserves supervised command restart metadata", () => {
    const args = commandRestartArgs({
      id: "tool_1",
      type: "command_supervise",
      title: "http-discovery: httpx",
      status: "stale",
      startedAt: Date.now(),
      metadata: {
        operationID: "school",
        laneID: "web_inventory",
        workUnitID: "work-unit-http",
        profileID: "http-discovery",
        variables: { inputFile: "queues/hosts.txt" },
        outputPrefix: "evidence/raw/http-discovery",
        manifestPath: "/tmp/manifest.json",
        worktree: "/tmp/worktree",
      },
    })

    expect(args).toEqual({
      operationID: "school",
      laneID: "web_inventory",
      workUnitID: "work-unit-http",
      profileID: "http-discovery",
      variables: { inputFile: "queues/hosts.txt" },
      outputPrefix: "evidence/raw/http-discovery",
      manifestPath: "/tmp/manifest.json",
      worktree: "/tmp/worktree",
      dryRun: false,
    })
  })
})
