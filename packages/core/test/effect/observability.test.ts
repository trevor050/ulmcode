import { afterEach, describe, expect, test } from "bun:test"
import { resource } from "@opencode-ai/core/effect/observability"

const otelResourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES
const otelServiceName = process.env.OTEL_SERVICE_NAME
const opencodeClient = process.env.OPENCODE_CLIENT

afterEach(() => {
  if (otelResourceAttributes === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES
  else process.env.OTEL_RESOURCE_ATTRIBUTES = otelResourceAttributes

  if (otelServiceName === undefined) delete process.env.OTEL_SERVICE_NAME
  else process.env.OTEL_SERVICE_NAME = otelServiceName

  if (opencodeClient === undefined) delete process.env.OPENCODE_CLIENT
  else process.env.OPENCODE_CLIENT = opencodeClient
})

describe("resource", () => {
  test("parses and decodes OTEL resource attributes", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.namespace=anomalyco,team=platform%2Cobservability,label=hello%3Dworld,key%2Fname=value%20here"

    expect(resource().attributes).toMatchObject({
      "service.namespace": "anomalyco",
      team: "platform,observability",
      label: "hello=world",
      "key/name": "value here",
    })
  })

  test("drops OTEL resource attributes when any entry is invalid", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "service.namespace=anomalyco,broken"

    expect(resource().attributes["service.namespace"]).toBeUndefined()
    expect(resource().attributes["opencode.client"]).toBeDefined()
  })

  test("keeps built-in attributes when env values conflict", () => {
    process.env.OPENCODE_CLIENT = "cli"
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "opencode.client=web,service.instance.id=override,service.namespace=anomalyco"

    expect(resource().attributes).toMatchObject({
      "opencode.client": "cli",
      "service.namespace": "anomalyco",
    })
    expect(resource().attributes["service.instance.id"]).not.toBe("override")
  })

  test("respects OTEL service identity and deployment attributes", () => {
    process.env.OTEL_SERVICE_NAME = "operator-service"
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.name=resource-service,service.version=9.9.9,deployment.environment.name=staging,team=platform"

    const current = resource()
    expect(current.serviceName).toBe("operator-service")
    expect(current.serviceVersion).toBe("9.9.9")
    expect(current.attributes).toMatchObject({
      "deployment.environment.name": "staging",
      team: "platform",
    })
    expect(current.attributes["service.name"]).toBeUndefined()
    expect(current.attributes["service.version"]).toBeUndefined()
  })
})
