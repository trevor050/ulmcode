import { expect, test } from "bun:test"
import { parseULMConfigToml } from "../../src/ulm/config"
import { operatorFallbackTimeoutMillis } from "../../src/ulm/operator-timeout"
import { createOperationGoal } from "../../src/ulm/operation-goal"
import { tmpdir } from "../fixture/fixture"

test("parseULMConfigToml reads operator timeout seconds", () => {
  expect(parseULMConfigToml("operator_timeout_seconds = 300\n")).toEqual({
    operator_timeout_seconds: 300,
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
