import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { SSEReplayBuffer } from "./sse-replay"

export const globalEventReplay = new SSEReplayBuffer()

GlobalBus.on("event", (event: GlobalEvent) => {
  globalEventReplay.publish(JSON.stringify(event))
})
