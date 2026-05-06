import { Provider } from "@/provider/provider"
import { Modelv2 } from "@/v2/model"
import { Effect, pipe } from "effect"
import * as DateTime from "effect/DateTime"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"

function modalities(input: Record<string, boolean>) {
  return Object.entries(input)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
}

function endpoint(model: Provider.Model): Modelv2.Endpoint {
  if (model.api.npm.includes("anthropic")) return { type: "anthropic/messages", url: model.api.url }
  return {
    type: "openai/completions",
    url: model.api.url,
    reasoning: model.capabilities.reasoning ? { type: "reasoning_content" } : undefined,
  }
}

function costs(model: Provider.Model) {
  return [
    {
      input: model.cost.input,
      output: model.cost.output,
      cache: model.cost.cache,
    },
    ...(model.cost.experimentalOver200K
      ? [
          {
            tier: { type: "context" as const, size: 200_000 },
            input: model.cost.experimentalOver200K.input,
            output: model.cost.experimentalOver200K.output,
            cache: model.cost.experimentalOver200K.cache,
          },
        ]
      : []),
  ]
}

export function providerModelToV2Info(model: Provider.Model) {
  return new Modelv2.Info({
    id: Modelv2.ID.make(model.id),
    providerID: Modelv2.ProviderID.make(model.providerID),
    family: model.family ? Modelv2.Family.make(model.family) : undefined,
    name: model.name,
    endpoint: endpoint(model),
    capabilities: {
      tools: model.capabilities.toolcall,
      input: modalities(model.capabilities.input),
      output: modalities(model.capabilities.output),
    },
    options: {
      headers: model.headers,
      body: model.options,
    },
    variants: Object.entries(model.variants ?? {}).map(([id, body]) => ({
      id: Modelv2.VariantID.make(id),
      headers: {},
      body,
    })),
    time: {
      released: DateTime.makeUnsafe(Date.parse(model.release_date) || 0),
    },
    cost: costs(model),
    status: model.status,
    limit: model.limit,
  })
}

export const modelHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.model", (handlers) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service

    return handlers.handle("models", () =>
      pipe(
        provider.list(),
        Effect.map((providers) =>
          Object.values(providers)
            .flatMap((item) => Object.values(item.models))
            .map(providerModelToV2Info)
            .sort((left, right) => right.time.released.epochMilliseconds - left.time.released.epochMilliseconds),
        ),
      ),
    )
  }),
)
