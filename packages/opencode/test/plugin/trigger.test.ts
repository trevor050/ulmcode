import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import { pathToFileURL } from "url"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const it = testEffect(Layer.mergeAll(Plugin.defaultLayer, CrossSpawnSpawner.defaultLayer))
const systemHook = "experimental.chat.system.transform"
const preChatHook = "pre_chat.messages.transform"

afterAll(() => {
  if (disableDefault === undefined) {
    delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
    return
  }
  process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = disableDefault
})

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "plugin.ts")
      yield* Effect.all(
        [
          Effect.promise(() => Bun.write(file, source)),
          Effect.promise(() =>
            Bun.write(
              path.join(dir, "opencode.json"),
              JSON.stringify(
                {
                  $schema: "https://opencode.ai/config.json",
                  plugin: [pathToFileURL(file).href],
                },
                null,
                2,
              ),
            ),
          ),
        ],
        { discard: true, concurrency: 2 },
      )
      return yield* self
    }),
  )
}

const triggerSystemTransform = Effect.fn("PluginTriggerTest.triggerSystemTransform")(function* () {
  const plugin = yield* Plugin.Service
  const out = { system: [] as string[] }
  yield* plugin.trigger(
    systemHook,
    {
      model: {
        providerID: ProviderID.anthropic,
        modelID: ModelID.make("claude-sonnet-4-6"),
      },
    },
    out,
  )
  return out.system
})

const triggerPreChatTransform = Effect.fn("PluginTriggerTest.triggerPreChatTransform")(function* () {
  const plugin = yield* Plugin.Service
  const out = {
    messages: [
      {
        info: { id: "msg_1", role: "user" },
        parts: [{ id: "prt_1", type: "text", text: "before" }],
      },
    ],
  } as any
  const result = yield* plugin.trigger(
    preChatHook,
    {
      sessionID: "ses_1",
      agent: "build",
      model: {
        providerID: ProviderID.make("test"),
        modelID: ModelID.make("test-model"),
      },
      messages: out.messages,
    },
    out,
  )
  return result.messages
})

describe("plugin.trigger", () => {
  it.live("runs synchronous hooks without crashing", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["sync"])
      }),
    ),
  )

  it.live("awaits asynchronous hooks", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: async (_input, output) => {`,
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["async"])
      }),
    ),
  )

  it.live("allows pre-chat hooks to replace messages", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(preChatHook)}: (_input, output) => {`,
        '    output.messages = [{ info: { id: "msg_2", role: "user" }, parts: [{ id: "prt_2", type: "text", text: "after" }] }]',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const messages = yield* triggerPreChatTransform()
        expect(messages).toHaveLength(1)
        expect(messages[0]?.parts[0]).toMatchObject({ type: "text", text: "after" })
      }),
    ),
  )
})
