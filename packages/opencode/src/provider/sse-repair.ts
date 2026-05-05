import { jsonrepair } from "jsonrepair"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "provider/sse-repair" })

export function repairSSEEvent(event: string): string {
  const lines = event.split("\n")
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith("data:")) continue

    const after = line.slice(5)
    const leading = after.match(/^\s*/)?.[0] ?? ""
    const payload = after.slice(leading.length)
    if (!payload || payload === "[DONE]") continue

    try {
      JSON.parse(payload)
      continue
    } catch {}

    try {
      const repaired = jsonrepair(payload)
      JSON.parse(repaired)
      lines[i] = "data:" + leading + repaired
      changed = true
      log.warn("sse chunk repaired", { preview: payload.slice(0, 200) })
    } catch {
      // Forward the original payload so the downstream parser reports the real provider error.
    }
  }
  return changed ? lines.join("\n") : event
}

export function repairSSE(res: Response): Response {
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""

  const transformed = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        while (true) {
          const idx = buffer.indexOf("\n\n")
          if (idx === -1) break
          const event = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          controller.enqueue(encoder.encode(repairSSEEvent(event) + "\n\n"))
        }
      },
      flush(controller) {
        buffer += decoder.decode()
        if (!buffer) return
        controller.enqueue(encoder.encode(repairSSEEvent(buffer)))
        buffer = ""
      },
    }),
  )

  return new Response(transformed, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}
