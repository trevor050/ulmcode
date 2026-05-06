const DEFAULT_RING_SIZE = 1024

export type StoredEvent = { id: number; data: string }

export class SSEReplayBuffer {
  private ring: StoredEvent[] = []
  private nextId = 0
  private listeners = new Set<(entry: StoredEvent) => void>()

  constructor(private maxSize: number = DEFAULT_RING_SIZE) {}

  publish(data: string): StoredEvent {
    const entry: StoredEvent = { id: ++this.nextId, data }
    this.ring.push(entry)
    if (this.ring.length > this.maxSize) this.ring.shift()
    for (const listener of this.listeners) listener(entry)
    return entry
  }

  subscribe(listener: (entry: StoredEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  eventsAfter(lastEventId: number): StoredEvent[] {
    if (lastEventId <= 0) return []
    return this.ring.filter((event) => event.id > lastEventId)
  }
}

export function parseLastEventId(header: string | null | undefined): number {
  if (!header) return 0
  const id = Number.parseInt(header, 10)
  return Number.isFinite(id) && id > 0 ? id : 0
}
