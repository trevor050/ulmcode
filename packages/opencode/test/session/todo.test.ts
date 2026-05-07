import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "../../src/session/session"
import { Todo } from "../../src/session/todo"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Todo.defaultLayer))

describe("Todo", () => {
  it.instance("keeps only pending and in-progress todos active", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service.use((svc) => svc.create({ title: "todos" }))
      const todo = yield* Todo.Service

      yield* todo.update({
        sessionID: session.id,
        todos: [
          { content: "map scope", status: "completed", priority: "high" },
          { content: "validate exploit", status: "in_progress", priority: "high" },
          { content: "write report", status: "pending", priority: "medium" },
          { content: "old branch", status: "cancelled", priority: "low" },
        ],
      })

      expect(yield* todo.get(session.id)).toEqual([
        { content: "validate exploit", status: "in_progress", priority: "high" },
        { content: "write report", status: "pending", priority: "medium" },
      ])

      yield* todo.update({
        sessionID: session.id,
        todos: [
          { content: "validate exploit", status: "completed", priority: "high" },
          { content: "write report", status: "cancelled", priority: "medium" },
        ],
      })

      expect(yield* todo.get(session.id)).toEqual([])
    }),
  )
})
