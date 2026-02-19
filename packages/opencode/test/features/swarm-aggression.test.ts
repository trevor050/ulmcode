import { describe, expect, test } from "bun:test"
import { SwarmAggressionPolicy } from "../../src/features/swarm/aggression"

describe("swarm aggression normalization", () => {
  test("normalizes friendly max-parallel labels", () => {
    expect(SwarmAggressionPolicy.normalize("Max parallel")).toBe("max_parallel")
    expect(SwarmAggressionPolicy.normalize("max-parallel")).toBe("max_parallel")
    expect(SwarmAggressionPolicy.normalize("MAX_PARALLEL")).toBe("max_parallel")
  })
})

