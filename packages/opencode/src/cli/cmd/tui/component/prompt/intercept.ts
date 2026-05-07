import type { ParsedKey, TextareaRenderable } from "@opentui/core"
import type { TuiInputInterceptHandler } from "@opencode-ai/plugin/tui"

const handlers = new Set<TuiInputInterceptHandler>()

export function register(handler: TuiInputInterceptHandler) {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function dispatch(event: ParsedKey, input: TextareaRenderable) {
  for (const handler of [...handlers]) {
    if (handler(event, input) === true) return true
  }
  return false
}

export function reset() {
  handlers.clear()
}
