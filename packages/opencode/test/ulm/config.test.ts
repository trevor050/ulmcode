import { expect, test } from "bun:test"
import { effectiveULMContinuation, parseULMConfigToml } from "../../src/ulm/config"
import { operatorFallbackTimeoutMillis } from "../../src/ulm/operator-timeout"
import { createOperationGoal } from "../../src/ulm/operation-goal"
import { tmpdir } from "../fixture/fixture"

test("parseULMConfigToml reads operator timeout seconds", () => {
  expect(
    parseULMConfigToml(`
continuation_enabled = false
turn_end_review = false
max_no_tool_continuation_turns = 3
inject_plan_max_chars = 24000
operator_fallback_enabled = false
operator_timeout_seconds = 300
max_repeated_operator_timeouts_per_kind = 4
trust_level = "unattended"
scan_profile = "balanced"
max_parallel_commands = 6
per_host_rate_limit_per_second = 2
stop_on_rate_limit_spike = true
agent_no_tool_timeout_seconds = 300
`),
  ).toEqual({
    continuation_enabled: false,
    turn_end_review: false,
    max_no_tool_continuation_turns: 3,
    inject_plan_max_chars: 24000,
    operator_fallback_enabled: false,
    operator_timeout_seconds: 300,
    max_repeated_operator_timeouts_per_kind: 4,
    trust_level: "unattended",
    scan_profile: "balanced",
    max_parallel_commands: 6,
    per_host_rate_limit_per_second: 2,
    stop_on_rate_limit_spike: true,
    agent_no_tool_timeout_seconds: 300,
  })
})

test("parseULMConfigToml ignores invalid operator timeout seconds", () => {
  expect(parseULMConfigToml('operator_timeout_seconds = "soon"\n')).toEqual({})
})

test("operator timeout config overrides operation goal timeout", async () => {
  await using dir = await tmpdir()
  const result = await createOperationGoal(dir.path, {
    operationID: "school",
    objective: "Authorized unattended run",
    continuation: { operatorFallbackTimeoutSeconds: 75 },
  })

  expect(operatorFallbackTimeoutMillis(result.goal, { operator_timeout_seconds: 300 })).toBe(300_000)
})

test("operator timeout config zero disables fallback timeout", async () => {
  await using dir = await tmpdir()
  const result = await createOperationGoal(dir.path, {
    operationID: "school",
    objective: "Authorized unattended run",
    continuation: { operatorFallbackTimeoutSeconds: 0.01 },
  })

  expect(operatorFallbackTimeoutMillis(result.goal, { operator_timeout_seconds: 0 })).toBeUndefined()
})

test("effectiveULMContinuation applies config overrides", async () => {
  await using dir = await tmpdir()
  const result = await createOperationGoal(dir.path, {
    operationID: "school",
    objective: "Authorized unattended run",
  })

  expect(
    effectiveULMContinuation(result.goal, {
      continuation_enabled: false,
      turn_end_review: false,
      max_no_tool_continuation_turns: 3,
      inject_plan_max_chars: 24000,
      operator_fallback_enabled: false,
      max_repeated_operator_timeouts_per_kind: 4,
    }),
  ).toEqual({
    enabled: false,
    turnEndReview: false,
    maxNoToolContinuationTurns: 3,
    injectPlanMaxChars: 24000,
    operatorFallbackEnabled: false,
    maxRepeatedOperatorTimeoutsPerKind: 4,
  })
})
