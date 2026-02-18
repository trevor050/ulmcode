import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { BackgroundAgentManager } from "../../src/features/background-agent/manager"
import { BackgroundListTool } from "../../src/tool/background_list"
import { BackgroundOutputTool } from "../../src/tool/background_output"
import { BackgroundCancelTool } from "../../src/tool/background_cancel"

const ctx = {
  sessionID: "session_parent",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe("tool.background_*", () => {
  test("lists and reads completed background output", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await BackgroundAgentManager.start({
          description: "Background check",
          prompt: "collect info",
          subagentType: "explore",
          parentSessionID: "session_parent",
          sessionID: "session_child",
          run: async () => {
            await sleep(30)
            return { output: "background done" }
          },
          cancel: () => {},
        })

        for (let i = 0; i < 30; i++) {
          const status = (await BackgroundAgentManager.get(task.id))?.status
          if (status === "completed") break
          await sleep(20)
        }

        const listTool = await BackgroundListTool.init()
        const listResult = await listTool.execute({ include_completed: true }, ctx as any)
        expect(listResult.output).toContain(task.id)

        const outputTool = await BackgroundOutputTool.init()
        const outputResult = await outputTool.execute({ task_id: task.id }, ctx as any)
        expect(outputResult.output).toContain("<task_result>")
        expect(outputResult.output).toContain("background done")
      },
    })
  })

  test("cancels running background task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await BackgroundAgentManager.start({
          description: "Long background check",
          prompt: "collect info",
          subagentType: "explore",
          parentSessionID: "session_parent",
          sessionID: "session_child",
          run: async ({ signal }) => {
            await new Promise<void>((resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  reject(new Error("aborted"))
                },
                { once: true },
              )
            })
            return { output: "" }
          },
          cancel: () => {},
        })

        const cancelTool = await BackgroundCancelTool.init()
        const result = await cancelTool.execute({ task_id: task.id }, ctx as any)
        expect(result.output).toContain("Cancelled background task")
        expect((await BackgroundAgentManager.get(task.id))?.status).toBe("cancelled")
      },
    })
  })
})
