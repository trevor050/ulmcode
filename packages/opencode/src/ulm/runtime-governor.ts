import fs from "fs/promises"
import path from "path"
import { operationPath, slug, type RuntimeSummaryRecord } from "./artifact"
import type { OperationGraphRecord, OperationLane } from "./operation-graph"
import {
  auditModelRoutes,
  resolveModelRuntime,
  type ModelRouteAudit,
  type ModelRuntimeCatalog,
  type ModelRuntimeInfo,
  type ProviderCatalogSource,
} from "./model-runtime-catalog"

export type GovernorDecision = {
  operationID: string
  laneID?: string
  action: "continue" | "compact" | "stop"
  reason: string
  modelRoute?: string
  remainingUSD?: number
  laneBudgetUSD?: number
  contextPressure?: RuntimeSummaryRecord["compaction"] extends infer C
    ? C extends { pressure?: infer P }
      ? P
      : undefined
    : undefined
  blockers: string[]
  recommendedTools: string[]
  modelContextLimit?: number
  modelOutputLimit?: number
  contextRatio?: number
  costCliffTokens?: number
  providerKind?: string
  fallbackModelRoutes?: string[]
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function firstReadyLane(graph: OperationGraphRecord) {
  const complete = new Set(graph.lanes.filter((lane) => lane.status === "complete").map((lane) => lane.id))
  return graph.lanes.find((lane) => {
    if (lane.status !== "ready" && lane.status !== "pending") return false
    return lane.dependsOn.every((dependency) => complete.has(dependency))
  })
}

function modelCallCount(runtime: RuntimeSummaryRecord | undefined, route: string | undefined, modelID: string | undefined) {
  if (!runtime?.modelCalls?.byModel) return 0
  if (route && runtime.modelCalls.byModel[route] !== undefined) return runtime.modelCalls.byModel[route]
  if (modelID && runtime.modelCalls.byModel[modelID] !== undefined) return runtime.modelCalls.byModel[modelID]
  return 0
}

function decideFromRuntime(input: {
  operationID: string
  lane?: OperationLane
  graph?: OperationGraphRecord
  runtime?: RuntimeSummaryRecord
  modelCatalog?: ModelRuntimeCatalog
}): GovernorDecision {
  const blockers: string[] = []
  const recommendedTools = ["operation_status", "runtime_summary"]
  const usage = input.runtime?.usage
  const pressure = input.runtime?.compaction?.pressure
  const remainingUSD =
    usage?.remainingUSD ??
    (usage?.budgetUSD !== undefined && usage.costUSD !== undefined ? usage.budgetUSD - usage.costUSD : undefined)
  const laneBudgetUSD = input.lane?.budget.maxUSD
  const laneSpent = input.lane ? (usage?.byLane?.[input.lane.id]?.costUSD ?? usage?.byAgent?.[input.lane.agent]?.costUSD) : undefined
  const model = input.lane ? resolveModelRuntime(input.lane.modelRoute, input.modelCatalog) : undefined
  const totalTokens = usage?.totalTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const contextRatio = model?.contextLimit ? Number((totalTokens / model.contextLimit).toFixed(4)) : undefined
  const routeCalls = modelCallCount(input.runtime, model?.route, model?.modelID)

  if (!input.graph) {
    blockers.push("operation graph is missing")
    recommendedTools.push("operation_schedule")
  }
  if (!input.runtime) {
    blockers.push("runtime summary is missing")
    recommendedTools.push("runtime_summary")
  }
  if (remainingUSD !== undefined && remainingUSD <= 0) blockers.push("operation budget exhausted")
  if (laneBudgetUSD !== undefined && laneSpent !== undefined && laneSpent >= laneBudgetUSD) {
    blockers.push(`lane budget exhausted for ${input.lane?.id}`)
  }
  if (input.lane && !model) {
    blockers.push(`model route metadata is missing for ${input.lane.modelRoute}`)
    recommendedTools.push("operation_schedule")
  }
  if (model && contextRatio !== undefined && contextRatio >= 0.9) {
    blockers.push(`model context is above 90% for ${model.route}`)
  }
  if (model && outputTokens >= model.outputLimit * 0.9) {
    blockers.push(`model output tokens are near limit for ${model.route}`)
  }
  if (model?.costCliffTokens && totalTokens >= model.costCliffTokens * 0.9) {
    blockers.push(`model cost cliff is near ${model.costCliffTokens} tokens for ${model.route}`)
  }
  if (model?.quota?.maxCalls !== undefined && routeCalls >= model.quota.maxCalls) {
    blockers.push(`model route quota exhausted for ${model.route}`)
  }
  if (model?.quota?.maxCalls !== undefined && model.quota.kind === "soft" && routeCalls >= model.quota.maxCalls * 0.8) {
    blockers.push(`model route soft quota is near ${model.route}`)
  }
  if (pressure === "critical") blockers.push("context pressure is critical")

  if (
    blockers.some(
      (item) => item.includes("budget exhausted") || item.includes("output tokens are near limit") || item.includes("quota exhausted"),
    )
  ) {
    return {
      operationID: input.operationID,
      laneID: input.lane?.id,
      action: "stop",
      reason: blockers.join("; "),
      modelRoute: input.lane?.modelRoute,
      remainingUSD,
      laneBudgetUSD,
      contextPressure: pressure,
      modelContextLimit: model?.contextLimit,
      modelOutputLimit: model?.outputLimit,
      contextRatio,
      costCliffTokens: model?.costCliffTokens,
      providerKind: model?.providerKind,
      fallbackModelRoutes: input.lane?.fallbackModelRoutes,
      blockers,
      recommendedTools: [...new Set([...recommendedTools, "operation_audit"])],
    }
  }

  if (
    pressure === "critical" ||
    pressure === "high" ||
    blockers.some((item) => item.includes("model context") || item.includes("cost cliff") || item.includes("model route metadata"))
  ) {
    return {
      operationID: input.operationID,
      laneID: input.lane?.id,
      action: "compact",
      reason: `context pressure is ${pressure}`,
      modelRoute: input.lane?.modelRoute,
      remainingUSD,
      laneBudgetUSD,
      contextPressure: pressure,
      modelContextLimit: model?.contextLimit,
      modelOutputLimit: model?.outputLimit,
      contextRatio,
      costCliffTokens: model?.costCliffTokens,
      providerKind: model?.providerKind,
      fallbackModelRoutes: input.lane?.fallbackModelRoutes,
      blockers,
      recommendedTools: [...new Set([...recommendedTools, "operation_resume"])],
    }
  }

  if (blockers.length) {
    return {
      operationID: input.operationID,
      laneID: input.lane?.id,
      action: "compact",
      reason: blockers.join("; "),
      modelRoute: input.lane?.modelRoute,
      remainingUSD,
      laneBudgetUSD,
      contextPressure: pressure,
      modelContextLimit: model?.contextLimit,
      modelOutputLimit: model?.outputLimit,
      contextRatio,
      costCliffTokens: model?.costCliffTokens,
      providerKind: model?.providerKind,
      fallbackModelRoutes: input.lane?.fallbackModelRoutes,
      blockers,
      recommendedTools: [...new Set(recommendedTools)],
    }
  }

  return {
    operationID: input.operationID,
    laneID: input.lane?.id,
    action: "continue",
    reason: input.lane ? `lane ${input.lane.id} is within recorded runtime limits` : "operation is within recorded runtime limits",
    modelRoute: input.lane?.modelRoute,
    remainingUSD,
    laneBudgetUSD,
    contextPressure: pressure,
    modelContextLimit: model?.contextLimit,
    modelOutputLimit: model?.outputLimit,
    contextRatio,
    costCliffTokens: model?.costCliffTokens,
    providerKind: model?.providerKind,
    fallbackModelRoutes: input.lane?.fallbackModelRoutes,
    blockers: [],
    recommendedTools: [...new Set(recommendedTools)],
  }
}

export async function evaluateRuntimeGovernor(
  worktree: string,
  input: { operationID: string; laneID?: string; modelCatalog?: ModelRuntimeCatalog },
) {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const graph = await readJson<OperationGraphRecord>(path.join(root, "plans", "operation-graph.json"))
  const runtime = await readJson<RuntimeSummaryRecord>(path.join(root, "deliverables", "runtime-summary.json"))
  const lane = input.laneID ? graph?.lanes.find((item) => item.id === input.laneID) : graph ? firstReadyLane(graph) : undefined
  if (input.laneID && graph && !lane) {
    return {
      operationID,
      laneID: input.laneID,
      action: "compact" as const,
      reason: `lane ${input.laneID} is missing from operation graph`,
      blockers: [`lane ${input.laneID} is missing from operation graph`],
      recommendedTools: ["operation_schedule", "operation_status"],
    }
  }
  return decideFromRuntime({ operationID, lane, graph, runtime, modelCatalog: input.modelCatalog })
}

function routeAuditMarkdown(audit: ModelRouteAudit) {
  return [
    `# Model Route Audit: ${audit.operationID}`,
    "",
    `checked_at: ${audit.checkedAt}`,
    "",
    "## Routes",
    "",
    "| Lane | Role | Route | Provider Kind | Provider Listed | Runtime Metadata | Quota Policy |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...audit.routes.map(
      (route) =>
        `| ${route.laneID ?? ""} | ${route.role} | ${route.route} | ${route.providerKind ?? "unknown"} | ${route.availableInProviderList ? "yes" : "no"} | ${route.hasRuntimeMetadata ? "yes" : "no"} | ${route.quotaPolicyKnown ? "yes" : "no"} |`,
    ),
    "",
    "## Gaps",
    "",
    ...(audit.gaps.length ? audit.gaps.map((gap) => `- ${gap}`) : ["- none"]),
    "",
  ].join("\n")
}

export async function writeRuntimeGovernorRouteAudit(
  worktree: string,
  input: {
    operationID: string
    providers: ProviderCatalogSource
    quotaOverrides?: Record<string, ModelRuntimeInfo["quota"] | undefined>
  },
) {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const graph = await readJson<OperationGraphRecord>(path.join(root, "plans", "operation-graph.json"))
  if (!graph) throw new Error("operation graph is missing")
  const routeKeys = new Set<string>()
  const routes: Array<{ route: string; laneID?: string; role: "primary" | "fallback" }> = []
  for (const lane of graph.lanes) {
    const primaryKey = `${lane.id}:primary:${lane.modelRoute}`
    if (!routeKeys.has(primaryKey)) {
      routeKeys.add(primaryKey)
      routes.push({ route: lane.modelRoute, laneID: lane.id, role: "primary" })
    }
    for (const fallback of lane.fallbackModelRoutes ?? []) {
      const fallbackKey = `${lane.id}:fallback:${fallback}`
      if (routeKeys.has(fallbackKey)) continue
      routeKeys.add(fallbackKey)
      routes.push({ route: fallback, laneID: lane.id, role: "fallback" })
    }
  }
  const record = auditModelRoutes({
    operationID,
    providers: input.providers,
    routes,
    quotaOverrides: input.quotaOverrides,
  })
  const json = path.join(root, "deliverables", "model-route-audit.json")
  const markdown = path.join(root, "deliverables", "model-route-audit.md")
  await fs.mkdir(path.dirname(json), { recursive: true })
  await fs.writeFile(json, JSON.stringify(record, null, 2) + "\n")
  await fs.writeFile(markdown, routeAuditMarkdown(record))
  return { operationID, json, markdown, record }
}

export function formatGovernorDecision(decision: GovernorDecision) {
  return [
    `# Governor Decision: ${decision.operationID}`,
    "",
    `- action: ${decision.action}`,
    `- reason: ${decision.reason}`,
    `- lane: ${decision.laneID ?? "none selected"}`,
    `- model_route: ${decision.modelRoute ?? "not set"}`,
    `- remaining_usd: ${decision.remainingUSD ?? "unknown"}`,
    `- lane_budget_usd: ${decision.laneBudgetUSD ?? "not set"}`,
    `- context_pressure: ${decision.contextPressure ?? "unknown"}`,
    `- model_context_limit: ${decision.modelContextLimit ?? "unknown"}`,
    `- model_output_limit: ${decision.modelOutputLimit ?? "unknown"}`,
    `- context_ratio: ${decision.contextRatio ?? "unknown"}`,
    `- cost_cliff_tokens: ${decision.costCliffTokens ?? "unknown"}`,
    `- provider_kind: ${decision.providerKind ?? "unknown"}`,
    `- fallback_model_routes: ${decision.fallbackModelRoutes?.length ? decision.fallbackModelRoutes.join(", ") : "none"}`,
    "",
    "## Blockers",
    "",
    ...(decision.blockers.length ? decision.blockers.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Recommended Tools",
    "",
    ...decision.recommendedTools.map((item) => `- ${item}`),
    "",
    "<governor_decision_json>",
    JSON.stringify(decision, null, 2),
    "</governor_decision_json>",
  ].join("\n")
}
