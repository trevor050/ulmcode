export namespace SwarmAggressionPolicy {
  export const values = ["none", "low", "balanced", "high", "max_parallel"] as const
  export type Level = (typeof values)[number]
  export const friendlyLabels: Record<Level, string> = {
    none: "None",
    low: "Low",
    balanced: "Balanced",
    high: "High",
    max_parallel: "Max parallel",
  }

  export const sourceValues = ["policy", "override", "default"] as const
  export type Source = (typeof sourceValues)[number]

  export type DerivedLimits = {
    allow_delegation: boolean
    max_active_background: number | null
    max_delegation_depth: number
  }

  function key(input: string) {
    return input.trim().toLowerCase().replace(/[\s-]+/g, "_")
  }

  export function normalize(input: string | undefined, fallback: Level = "balanced"): Level {
    if (!input) return fallback
    const normalized = key(input)
    if ((values as readonly string[]).includes(normalized)) return normalized as Level
    if (normalized === "maxparallel") return "max_parallel"
    return fallback
  }

  export function derive(input: { aggression: Level; maxParallelDepthCap?: number }): DerivedLimits {
    const cap = Math.max(1, input.maxParallelDepthCap ?? 4)
    if (input.aggression === "none") {
      return {
        allow_delegation: false,
        max_active_background: 0,
        max_delegation_depth: 0,
      }
    }
    if (input.aggression === "low") {
      return {
        allow_delegation: true,
        max_active_background: 2,
        max_delegation_depth: 1,
      }
    }
    if (input.aggression === "balanced") {
      return {
        allow_delegation: true,
        max_active_background: 4,
        max_delegation_depth: 2,
      }
    }
    if (input.aggression === "high") {
      return {
        allow_delegation: true,
        max_active_background: 8,
        max_delegation_depth: 3,
      }
    }
    return {
      allow_delegation: true,
      max_active_background: null,
      max_delegation_depth: cap,
    }
  }
}
