import { expect, test } from "bun:test"
import { defaultProfileMcp } from "../../src/cli/cmd/profile"

test("defaultProfileMcp does not ship with vercel", () => {
  const mcp = defaultProfileMcp() as Record<string, unknown>
  expect(Object.prototype.hasOwnProperty.call(mcp, "vercel")).toBe(false)
})

