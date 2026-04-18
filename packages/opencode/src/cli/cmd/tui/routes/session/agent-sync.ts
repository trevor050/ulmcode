import type { Message } from "@opencode-ai/sdk/v2"

export function latestPrimaryAgent(input: { messages: Message[]; primaryAgents: string[] }) {
  let latest: Message | undefined
  for (const msg of input.messages) {
    if (msg.role !== "user" || !msg.agent || !input.primaryAgents.includes(msg.agent)) continue
    if (!latest) {
      latest = msg
      continue
    }
    const created = msg.time?.created ?? 0
    const latestCreated = latest.time?.created ?? 0
    if (created > latestCreated) {
      latest = msg
      continue
    }
    if (created === latestCreated && msg.id && latest.id && msg.id > latest.id) {
      latest = msg
    }
  }
  return latest?.agent
}
