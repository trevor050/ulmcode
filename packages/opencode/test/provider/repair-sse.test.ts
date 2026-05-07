import { expect, test } from "bun:test"
import { repairSSE, repairSSEEvent } from "@/provider/sse-repair"

function sseResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

async function readAll(res: Response) {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

test("repairSSEEvent passes valid events unchanged", () => {
  const valid = `data: {"id":"abc","choices":[{"delta":{"content":"hi"}}]}`
  expect(repairSSEEvent(valid)).toBe(valid)
})

test("repairSSEEvent passes [DONE] unchanged", () => {
  expect(repairSSEEvent("data: [DONE]")).toBe("data: [DONE]")
})

test("repairSSEEvent leaves non-data lines untouched", () => {
  const block = "event: ping\n: keep-alive\nid: 5"
  expect(repairSSEEvent(block)).toBe(block)
})

test("repairSSEEvent repairs malformed JSON payloads", () => {
  const broken = `data: {"id":"abc","choices":[{"delta":{"content":"data: {"id":"nested"}"}}]}`
  const repaired = repairSSEEvent(broken)
  expect(repaired).not.toBe(broken)
  expect(() => JSON.parse(repaired.slice("data:".length).trim())).not.toThrow()
})

test("repairSSE passes through non-SSE responses unchanged", () => {
  const res = new Response('{"ok":true}', { headers: { "content-type": "application/json" } })
  expect(repairSSE(res)).toBe(res)
})

test("repairSSE repairs events while streaming", async () => {
  const valid = `data: {"ok":true}`
  const broken = `data: {"id":"abc","choices":[{"delta":{"content":"data: {"id":"nested"}"}}]}`
  const out = await readAll(repairSSE(sseResponse(`${valid}\n\n${broken}\n\ndata: [DONE]\n\n`)))
  const events = out.split("\n\n").filter(Boolean)
  expect(events[0]).toBe(valid)
  expect(events[2]).toBe("data: [DONE]")
  expect(() => JSON.parse(events[1]!.slice("data:".length).trim())).not.toThrow()
})

test("repairSSE handles events split across stream chunks", async () => {
  const event = `data: {"id":"a","choices":[{"delta":{"content":"ok"}}]}\n\n`
  const encoder = new TextEncoder()
  const bytes = encoder.encode(event)
  const split = Math.floor(bytes.length / 2)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, split))
      controller.enqueue(bytes.slice(split))
      controller.close()
    },
  })
  const out = await readAll(repairSSE(new Response(stream, { headers: { "content-type": "text/event-stream" } })))
  expect(out).toBe(event)
})
