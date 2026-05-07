import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

function withTmpInstance<A, E, R>(self: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (dir) => self(dir.path).pipe(provideInstance(dir.path)),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  )
}

const it = testEffect(
  SystemPrompt.layer.pipe(
    Layer.provide(
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
        }),
      ),
    ),
  ),
)

describe("session.system", () => {
  it.effect("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(build)
      const second = yield* prompt.skills(build)
      const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      expect(first).toBe(second)

      const alpha = output.indexOf("<name>alpha-skill</name>")
      const middle = output.indexOf("<name>middle-skill</name>")
      const zeta = output.indexOf("<name>zeta-skill</name>")

      expect(alpha).toBeGreaterThan(-1)
      expect(middle).toBeGreaterThan(alpha)
      expect(zeta).toBeGreaterThan(middle)
    }),
  )

  it.effect("environment omits ULM context when no operation goal is active", () =>
    withTmpInstance((dir) =>
      Effect.gen(function* () {
        const prompt = yield* SystemPrompt.Service
        const output = (yield* prompt.environment(model)).join("\n")

        expect(output).toContain(`Working directory: ${dir}`)
        expect(output).not.toContain("<ulm_operation_context>")
      }),
    ),
  )

  it.effect("environment includes compact active ULM goal context and missing inventory hint", () =>
    withTmpInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeJson(path.join(dir, ".ulmcode", "operations", "school", "goals", "operation-goal.json"), {
          operationID: "school",
          objective: "Authorized overnight district assessment",
          targetDurationHours: 20,
          status: "active",
          updatedAt: "2026-05-06T00:00:00.000Z",
        }))
        yield* Effect.promise(() => writeJson(path.join(dir, ".ulmcode", "operations", "school", "supervisor", "supervisor-review-1.json"), {
          generatedAt: "2026-05-06T00:10:00.000Z",
          decisions: [{ action: "blocked", reason: "operation plan is missing", requiredNextTool: "operation_plan" }],
        }))

        const prompt = yield* SystemPrompt.Service
        const output = (yield* prompt.environment(model)).join("\n")

        expect(output).toContain("<ulm_operation_context>")
        expect(output).toContain("operation: school")
        expect(output).toContain("target_duration_hours: 20")
        expect(output).toContain("next_tool=operation_plan")
        expect(output).toContain("tool_inventory: missing; call tool_inventory before broad discovery")
        expect(output).toContain("foreground_command_policy")
        expect(output).toContain("operator_availability_policy")
        expect(output).toContain("assume the operator is unavailable after execution starts")
      }),
    ),
  )

  it.effect("environment caps ULM tool inventory facts", () =>
    withTmpInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeJson(path.join(dir, ".ulmcode", "operations", "school", "goals", "operation-goal.json"), {
          operationID: "school",
          objective: "Authorized overnight district assessment",
          targetDurationHours: 20,
          status: "active",
          updatedAt: "2026-05-06T00:00:00.000Z",
        }))
        yield* Effect.promise(() => writeJson(path.join(dir, ".ulmcode", "operations", "school", "tool-inventory", "tool-inventory.json"), {
          counts: { total: 20, installed: 10, missing: 10, highValueMissing: 10 },
          tools: Array.from({ length: 20 }, (_, index) => ({
            id: `tool-${index + 1}`,
            installed: index < 10,
            highValue: true,
          })),
          nextActions: ["Review high-value missing tools before broad discovery."],
        }))

        const prompt = yield* SystemPrompt.Service
        const output = (yield* prompt.environment(model)).join("\n")
        const block = output.match(/<ulm_operation_context>[\s\S]*<\/ulm_operation_context>/)?.[0] ?? ""

        expect(block).toContain("installed_high_value: tool-1, tool-2, tool-3, tool-4, tool-5, tool-6, tool-7, tool-8")
        expect(block).not.toContain("tool-9")
        expect(block).toContain("missing_high_value: tool-11, tool-12, tool-13, tool-14, tool-15, tool-16, tool-17, tool-18")
        expect(block).not.toContain("tool-19")
        expect(block.split(/\s+/).length).toBeLessThan(700)
      }),
    ),
  )
})
