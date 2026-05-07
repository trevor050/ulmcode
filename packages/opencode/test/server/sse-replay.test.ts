import { describe, expect, test } from "bun:test"
import { parseLastEventId, SSEReplayBuffer } from "../../src/server/sse-replay"

describe("SSEReplayBuffer", () => {
  test("assigns monotonic ids and returns events after a cursor", () => {
    const buffer = new SSEReplayBuffer(3)
    const first = buffer.publish("one")
    const second = buffer.publish("two")
    const third = buffer.publish("three")

    expect([first.id, second.id, third.id]).toEqual([1, 2, 3])
    expect(buffer.eventsAfter(1)).toEqual([second, third])
  })

  test("keeps only the configured ring size", () => {
    const buffer = new SSEReplayBuffer(2)
    buffer.publish("one")
    const second = buffer.publish("two")
    const third = buffer.publish("three")

    expect(buffer.eventsAfter(0)).toEqual([])
    expect(buffer.eventsAfter(1)).toEqual([second, third])
  })

  test("notifies subscribers and unsubscribes cleanly", () => {
    const buffer = new SSEReplayBuffer()
    const seen: string[] = []
    const unsubscribe = buffer.subscribe((event) => seen.push(event.data))

    buffer.publish("one")
    unsubscribe()
    buffer.publish("two")

    expect(seen).toEqual(["one"])
  })
})

describe("parseLastEventId", () => {
  test("returns positive integer ids and ignores invalid headers", () => {
    expect(parseLastEventId("42")).toBe(42)
    expect(parseLastEventId("42-extra")).toBe(42)
    expect(parseLastEventId("0")).toBe(0)
    expect(parseLastEventId("-1")).toBe(0)
    expect(parseLastEventId("nope")).toBe(0)
    expect(parseLastEventId(undefined)).toBe(0)
  })
})
