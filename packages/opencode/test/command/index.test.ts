import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Command } from "../../src/command"
import { testEffect } from "../lib/effect"

const it = testEffect(Command.defaultLayer)

describe("Command", () => {
  it.instance("registers built-in clear task commands", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const clear = yield* command.get(Command.Default.CLEAR_TASKS)
      const clearZh = yield* command.get(Command.Default.CLEAR_TASKS_ZH)

      expect(clear).toMatchObject({
        name: "clear-tasks",
        description: "clear all active todos",
        source: "command",
        hints: [],
      })
      expect(clear?.template).toContain('{"todos":[]}')
      expect(clearZh).toMatchObject({
        name: "清除任务",
        description: "清除所有待办任务",
        source: "command",
        hints: [],
      })
      expect(clearZh?.template).toBe(clear?.template)
    }),
  )
})
