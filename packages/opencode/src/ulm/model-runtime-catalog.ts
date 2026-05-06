export type ModelRuntimeInfo = {
  route: string
  providerID: string
  modelID: string
  providerKind: "api" | "subscription" | "local" | "unknown"
  contextLimit: number
  outputLimit: number
  inputUSDPerMTok?: number
  outputUSDPerMTok?: number
  cacheReadUSDPerMTok?: number
  cacheWriteUSDPerMTok?: number
  costCliffTokens?: number
  quota?: {
    kind: "soft" | "hard"
    window: "daily" | "weekly" | "monthly" | "unknown"
    maxCalls?: number
    maxUSD?: number
  }
}

export type ModelRuntimeCatalog = Record<string, Partial<ModelRuntimeInfo>>
export type ModelRouteAuditInput = {
  operationID: string
  providers: ProviderCatalogSource
  routes: Array<{ route: string; laneID?: string; role: "primary" | "fallback" }>
  quotaOverrides?: Record<string, ModelRuntimeInfo["quota"] | undefined>
}

export type ModelRouteAudit = {
  operationID: string
  checkedAt: string
  routes: Array<{
    route: string
    laneID?: string
    role: "primary" | "fallback"
    providerID?: string
    modelID?: string
    providerKind?: ModelRuntimeInfo["providerKind"]
    availableInProviderList: boolean
    hasRuntimeMetadata: boolean
    quotaPolicyKnown: boolean
    contextLimit?: number
    outputLimit?: number
    quota?: ModelRuntimeInfo["quota"]
  }>
  gaps: string[]
}

export type ProviderCatalogSource = Record<
  string,
  {
    source?: string
    models?: Record<
      string,
      {
        limit?: { context?: number; output?: number }
        cost?: {
          input?: number
          output?: number
          cache?: { read?: number; write?: number }
          experimentalOver200K?: {
            input?: number
            output?: number
            cache?: { read?: number; write?: number }
          }
        }
      }
    >
  }
>

const DEFAULTS: ModelRuntimeCatalog = {
  "openai/gpt-5.5-fast": {
    providerKind: "api",
    contextLimit: 1_000_000,
    outputLimit: 128_000,
    inputUSDPerMTok: 5,
    outputUSDPerMTok: 30,
    cacheReadUSDPerMTok: 0.5,
    costCliffTokens: 270_000,
  },
  "openai/gpt-5.4-mini-fast": {
    providerKind: "api",
    contextLimit: 270_000,
    outputLimit: 64_000,
    inputUSDPerMTok: 0.75,
    outputUSDPerMTok: 4.5,
    cacheReadUSDPerMTok: 0.075,
    costCliffTokens: 270_000,
  },
  "opencode-go/default": {
    providerKind: "subscription",
    contextLimit: 200_000,
    outputLimit: 32_000,
    quota: { kind: "soft", window: "unknown" },
  },
}

function providerKind(providerID: string, provider: { source?: string }) {
  if (providerID === "opencode-go" || providerID.includes("pro")) return "subscription"
  if (provider.source === "env" || provider.source === "api" || provider.source === "config") return "api"
  if (provider.source === "custom") return "unknown"
  return "unknown"
}

export function buildModelRuntimeCatalog(providers: ProviderCatalogSource): ModelRuntimeCatalog {
  const catalog: ModelRuntimeCatalog = {}
  for (const [providerID, provider] of Object.entries(providers)) {
    for (const [modelID, model] of Object.entries(provider.models ?? {})) {
      const contextLimit = model.limit?.context
      const outputLimit = model.limit?.output
      if (!contextLimit || !outputLimit) continue
      const route = `${providerID}/${modelID}`
      catalog[route] = {
        providerKind: providerKind(providerID, provider),
        contextLimit,
        outputLimit,
        inputUSDPerMTok: model.cost?.input,
        outputUSDPerMTok: model.cost?.output,
        cacheReadUSDPerMTok: model.cost?.cache?.read,
        cacheWriteUSDPerMTok: model.cost?.cache?.write,
        costCliffTokens: model.cost?.experimentalOver200K ? 200_000 : undefined,
      }
    }
  }
  return catalog
}

export function splitModelRoute(route: string) {
  const [providerID, ...modelParts] = route.split("/")
  const modelID = modelParts.join("/")
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

export function resolveModelRuntime(route: string, catalog: ModelRuntimeCatalog = {}): ModelRuntimeInfo | undefined {
  const parsed = splitModelRoute(route)
  if (!parsed) return undefined
  const merged = { ...DEFAULTS[route], ...catalog[route] }
  const providerKind =
    merged.providerKind ?? (parsed.providerID === "opencode-go" || parsed.providerID.includes("pro") ? "subscription" : "unknown")
  const contextLimit = merged.contextLimit
  const outputLimit = merged.outputLimit
  if (!contextLimit || !outputLimit) return undefined
  return {
    route,
    providerID: parsed.providerID,
    modelID: parsed.modelID,
    providerKind,
    contextLimit,
    outputLimit,
    inputUSDPerMTok: merged.inputUSDPerMTok,
    outputUSDPerMTok: merged.outputUSDPerMTok,
    cacheReadUSDPerMTok: merged.cacheReadUSDPerMTok,
    cacheWriteUSDPerMTok: merged.cacheWriteUSDPerMTok,
    costCliffTokens: merged.costCliffTokens,
    quota: merged.quota,
  }
}

export function estimateModelCostUSD(input: {
  model: ModelRuntimeInfo
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}) {
  return (
    ((input.inputTokens * (input.model.inputUSDPerMTok ?? 0)) +
      (input.outputTokens * (input.model.outputUSDPerMTok ?? 0)) +
      ((input.cacheReadTokens ?? 0) * (input.model.cacheReadUSDPerMTok ?? 0)) +
      ((input.cacheWriteTokens ?? 0) * (input.model.cacheWriteUSDPerMTok ?? 0))) /
    1_000_000
  )
}

export function auditModelRoutes(input: ModelRouteAuditInput): ModelRouteAudit {
  const discoveredCatalog = buildModelRuntimeCatalog(input.providers)
  const catalog: ModelRuntimeCatalog = { ...discoveredCatalog }
  for (const [route, quota] of Object.entries(input.quotaOverrides ?? {})) {
    if (!quota) continue
    catalog[route] = { ...catalog[route], quota }
  }
  const gaps: string[] = []
  const routes = input.routes.map((item) => {
    const parsed = splitModelRoute(item.route)
    const provider = parsed ? input.providers[parsed.providerID] : undefined
    const availableInProviderList = Boolean(parsed && provider?.models?.[parsed.modelID])
    const runtime = resolveModelRuntime(item.route, catalog)
    if (!parsed) gaps.push(`${item.route}: route must use provider/model format`)
    if (parsed && !availableInProviderList) gaps.push(`${item.route}: route is not present in provider model list`)
    if (!runtime) gaps.push(`${item.route}: runtime metadata is missing`)
    if (runtime && !runtime.quota) gaps.push(`${item.route}: quota policy is not recorded`)
    return {
      route: item.route,
      laneID: item.laneID,
      role: item.role,
      providerID: parsed?.providerID,
      modelID: parsed?.modelID,
      providerKind: runtime?.providerKind,
      availableInProviderList,
      hasRuntimeMetadata: Boolean(runtime),
      quotaPolicyKnown: Boolean(runtime?.quota),
      contextLimit: runtime?.contextLimit,
      outputLimit: runtime?.outputLimit,
      quota: runtime?.quota,
    }
  })
  return {
    operationID: input.operationID,
    checkedAt: new Date().toISOString(),
    routes,
    gaps,
  }
}
