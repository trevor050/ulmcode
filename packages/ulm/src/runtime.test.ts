import { expect, it } from "bun:test"
import { loopbackTarget, parseVerdict, usedToolSincePreviousIdle } from "./runtime"

it("counts tool use only in the terminal Session turn", () => {
  expect(usedToolSincePreviousIdle([
    { type: "assistant", content: [{ type: "tool" }] },
    { type: "idle" },
    { type: "user" },
    { type: "assistant", content: [{ type: "text" }] },
    { type: "idle" },
  ])).toBe(false)

  expect(usedToolSincePreviousIdle([
    { type: "idle" },
    { type: "user" },
    { type: "assistant", content: [{ type: "tool" }] },
    { type: "assistant", content: [{ type: "text" }] },
    { type: "idle" },
  ])).toBe(true)
})

it("fails closed on malformed goal-checker output", () => {
  expect(parseVerdict('{"verdict":"done","reason":"all gates passed"}')).toEqual({ verdict: "done", reason: "all gates passed" })
  expect(parseVerdict("The goal is done.")).toBeUndefined()
  expect(parseVerdict('{"verdict":"done-ish","reason":"unclear"}')).toBeUndefined()
})

it("accepts only credential-free loopback origins for the synthetic lab adapter", () => {
  expect(loopbackTarget("http://127.0.0.1:8080")).toBe(true)
  expect(loopbackTarget("http://localhost:8080")).toBe(true)
  expect(loopbackTarget("https://localhost:8080")).toBe(false)
  expect(loopbackTarget("http://example.test")).toBe(false)
  expect(loopbackTarget("http://user:secret@127.0.0.1:8080")).toBe(false)
  expect(loopbackTarget("http://127.0.0.1:8080/lab")).toBe(false)
})
