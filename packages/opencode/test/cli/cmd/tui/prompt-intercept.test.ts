import { afterEach, describe, expect, test } from "bun:test"
import type { ParsedKey, TextareaRenderable } from "@opentui/core"
import * as Intercept from "../../../../src/cli/cmd/tui/component/prompt/intercept"

const event = { name: "x" } as ParsedKey
const input = {} as TextareaRenderable

afterEach(() => {
  Intercept.reset()
})

describe("prompt input intercept", () => {
  test("dispatches handlers until one consumes the key event", () => {
    const seen: string[] = []
    Intercept.register(() => {
      seen.push("first")
    })
    Intercept.register(() => {
      seen.push("second")
      return true
    })
    Intercept.register(() => {
      seen.push("third")
      return true
    })

    expect(Intercept.dispatch(event, input)).toBe(true)
    expect(seen).toEqual(["first", "second"])
  })

  test("unregisters handlers", () => {
    const seen: string[] = []
    const unregister = Intercept.register(() => {
      seen.push("handler")
      return true
    })

    unregister()

    expect(Intercept.dispatch(event, input)).toBe(false)
    expect(seen).toEqual([])
  })
})
