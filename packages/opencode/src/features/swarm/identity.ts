export namespace SwarmIdentity {
  export type ChainItem = {
    callerId: string
    sessionId: string
    agent: string
    timestamp: string
  }

  function uniq(chain: ChainItem[]) {
    const seen = new Set<string>()
    const result: ChainItem[] = []
    for (const item of chain) {
      const key = `${item.callerId}:${item.sessionId}:${item.agent}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
    return result
  }

  export function normalize(input: unknown) {
    if (!Array.isArray(input)) return [] as ChainItem[]
    return uniq(
      input
        .filter((item): item is ChainItem => !!item && typeof item === "object")
        .filter(
          (item) =>
            typeof item.callerId === "string" &&
            typeof item.sessionId === "string" &&
            typeof item.agent === "string" &&
            typeof item.timestamp === "string",
        ),
    )
  }

  export function build(input: {
    sessionID: string
    agent: string
    callerID?: string
    existing?: ChainItem[]
  }) {
    const now = new Date().toISOString()
    const callerId = input.callerID ?? `caller_${input.sessionID}`
    const base = normalize(input.existing)
    const next: ChainItem = {
      callerId,
      sessionId: input.sessionID,
      agent: input.agent,
      timestamp: now,
    }
    return uniq([...base, next])
  }

  export function depth(chain: ChainItem[]) {
    return Math.max(chain.length - 1, 0)
  }
}
