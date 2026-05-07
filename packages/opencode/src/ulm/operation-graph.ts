import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"

export const REQUIRED_OPERATION_LANES = [
  "district_profile",
  "person_recon",
  "recon",
  "web_inventory",
  "identity_graph",
  "identity_auth_review",
  "saas_cloud_review",
  "evidence_normalization",
  "finding_validation",
  "report_evidence_index",
  "report_writing",
  "report_technical_review",
  "report_executive_review",
  "report_review",
  "operator_summary",
] as const

export type OperationLaneID = (typeof REQUIRED_OPERATION_LANES)[number] | string
export type OperationLaneStatus = "pending" | "ready" | "running" | "blocked" | "complete" | "failed"
export type OperationSafetyMode = "non_destructive" | "interactive_destructive"
export type OperationTrustLevel = "guided" | "moderate" | "unattended" | "lab_full"
export type OperationScanProfile = "paranoid" | "stealth" | "balanced" | "aggressive" | "lab-insane"

export type OperationLane = {
  id: OperationLaneID
  title: string
  agent: string
  status: OperationLaneStatus
  dependsOn: string[]
  modelRoute: string
  fallbackModelRoutes: string[]
  allowedTools: string[]
  expectedArtifacts: string[]
  budget: {
    maxTokens?: number
    maxUSD?: number
  }
  restartPolicy: {
    restartable: boolean
    maxAttempts: number
    staleAfterMinutes: number
  }
  activeJobs?: Array<{ id: string; type: string; status: string; updatedAt: string }>
  operationID: string
}

export type OperationGraphRecord = {
  operationID: string
  safetyMode: OperationSafetyMode
  trustLevel: OperationTrustLevel
  scanProfile: OperationScanProfile
  maxConcurrentLanes: number
  createdAt: string
  updatedAt: string
  lanes: OperationLane[]
}

export type OperationScheduleInput = {
  operationID: string
  safetyMode?: OperationSafetyMode
  trustLevel?: OperationTrustLevel
  scanProfile?: OperationScanProfile
  maxConcurrentLanes?: number
  budgetUSD?: number
  modelRoutes?: Record<string, string | undefined>
  fallbackModelRoutes?: Record<string, string[] | undefined>
}

const BASE_LANES: Array<Omit<OperationLane, "operationID" | "modelRoute" | "fallbackModelRoutes" | "budget" | "restartPolicy" | "status"> & {
  route: string
  budgetWeight: number
  staleAfterMinutes: number
}> = [
  {
    id: "district_profile",
    title: "District profile and public system map",
    agent: "recon",
    dependsOn: [],
    allowedTools: ["district_profile", "webfetch", "websearch", "evidence_record", "task"],
    expectedArtifacts: ["profiles/district-profile.json", "profiles/district-profile.md"],
    route: "throughput",
    budgetWeight: 0.07,
    staleAfterMinutes: 90,
  },
  {
    id: "person_recon",
    title: "Role-focused public person recon",
    agent: "person-recon",
    dependsOn: ["district_profile"],
    allowedTools: ["person_profile", "webfetch", "websearch", "evidence_record", "task"],
    expectedArtifacts: ["profiles/people/"],
    route: "throughput",
    budgetWeight: 0.08,
    staleAfterMinutes: 90,
  },
  {
    id: "recon",
    title: "Recon and service inventory",
    agent: "recon",
    dependsOn: ["district_profile"],
    allowedTools: ["operation_checkpoint", "command_supervise", "evidence_record", "task"],
    expectedArtifacts: ["evidence/raw/", "commands/", "status.md"],
    route: "throughput",
    budgetWeight: 0.1,
    staleAfterMinutes: 90,
  },
  {
    id: "web_inventory",
    title: "Web inventory and screenshots",
    agent: "recon",
    dependsOn: ["recon"],
    allowedTools: ["command_supervise", "evidence_record", "task"],
    expectedArtifacts: ["evidence/raw/httpx.jsonl", "evidence/screenshots/"],
    route: "throughput",
    budgetWeight: 0.07,
    staleAfterMinutes: 90,
  },
  {
    id: "identity_graph",
    title: "People, roles, systems, and access graph",
    agent: "attack-map",
    dependsOn: ["person_recon", "recon"],
    allowedTools: ["identity_graph", "evidence_record", "finding_record", "task"],
    expectedArtifacts: ["profiles/identity-graph.json", "profiles/identity-graph.md"],
    route: "reasoning",
    budgetWeight: 0.07,
    staleAfterMinutes: 90,
  },
  {
    id: "identity_auth_review",
    title: "Identity and authorization review",
    agent: "validator",
    dependsOn: ["identity_graph"],
    allowedTools: ["evidence_record", "finding_record", "task"],
    expectedArtifacts: ["evidence/", "findings/"],
    route: "reasoning",
    budgetWeight: 0.09,
    staleAfterMinutes: 120,
  },
  {
    id: "saas_cloud_review",
    title: "SaaS and cloud exposure review",
    agent: "validator",
    dependsOn: ["district_profile", "recon"],
    allowedTools: ["evidence_record", "finding_record", "task"],
    expectedArtifacts: ["evidence/", "findings/"],
    route: "reasoning",
    budgetWeight: 0.07,
    staleAfterMinutes: 120,
  },
  {
    id: "evidence_normalization",
    title: "Evidence normalization",
    agent: "evidence",
    dependsOn: ["recon", "web_inventory", "identity_graph", "identity_auth_review", "saas_cloud_review"],
    allowedTools: ["evidence_normalize", "evidence_record", "finding_record", "report_lint"],
    expectedArtifacts: ["evidence-index.json", "findings/"],
    route: "small",
    budgetWeight: 0.07,
    staleAfterMinutes: 60,
  },
  {
    id: "finding_validation",
    title: "Finding validation and dedupe",
    agent: "validator",
    dependsOn: ["evidence_normalization"],
    allowedTools: ["finding_record", "report_lint", "operation_stage_gate"],
    expectedArtifacts: ["findings/", "deliverables/stage-gates/"],
    route: "reasoning",
    budgetWeight: 0.09,
    staleAfterMinutes: 90,
  },
  {
    id: "report_evidence_index",
    title: "Report evidence index and artifact inventory",
    agent: "evidence",
    dependsOn: ["finding_validation"],
    allowedTools: ["evidence_normalize", "evidence_record", "report_lint", "task"],
    expectedArtifacts: ["evidence-index.json", "deliverables/final/evidence-index.json"],
    route: "small",
    budgetWeight: 0.04,
    staleAfterMinutes: 60,
  },
  {
    id: "report_writing",
    title: "Report writing",
    agent: "report-writer",
    dependsOn: ["report_evidence_index"],
    allowedTools: ["report_outline", "report_lint", "report_render", "task"],
    expectedArtifacts: ["reports/report-outline.md", "reports/report.md", "deliverables/final/report.html"],
    route: "reporting",
    budgetWeight: 0.11,
    staleAfterMinutes: 120,
  },
  {
    id: "report_technical_review",
    title: "Technical report review",
    agent: "report-reviewer",
    dependsOn: ["report_writing"],
    allowedTools: ["report_lint", "finding_record", "task"],
    expectedArtifacts: ["deliverables/final/technical-appendix.md", "reports/report.md"],
    route: "review",
    budgetWeight: 0.04,
    staleAfterMinutes: 60,
  },
  {
    id: "report_executive_review",
    title: "Executive and board-ready report review",
    agent: "report-reviewer",
    dependsOn: ["report_writing"],
    allowedTools: ["report_lint", "task"],
    expectedArtifacts: ["deliverables/final/executive-summary.md", "reports/report.md"],
    route: "review",
    budgetWeight: 0.04,
    staleAfterMinutes: 60,
  },
  {
    id: "report_review",
    title: "Report review",
    agent: "report-reviewer",
    dependsOn: ["report_technical_review", "report_executive_review"],
    allowedTools: ["report_lint", "report_render", "operation_audit"],
    expectedArtifacts: [
      "deliverables/final/report.pdf",
      "deliverables/final/report.html",
      "deliverables/final/findings.json",
      "deliverables/final/evidence-index.json",
      "deliverables/final/operator-review.md",
      "deliverables/final/executive-summary.md",
      "deliverables/final/technical-appendix.md",
      "deliverables/final/runtime-summary.md",
      "deliverables/final/manifest.json",
    ],
    route: "review",
    budgetWeight: 0.04,
    staleAfterMinutes: 60,
  },
  {
    id: "operator_summary",
    title: "Operator summary and handoff",
    agent: "pentest",
    dependsOn: ["report_review"],
    allowedTools: ["runtime_summary", "eval_scorecard", "operation_audit", "operation_checkpoint"],
    expectedArtifacts: [
      "deliverables/final/operator-review.md",
      "deliverables/final/runtime-summary.md",
      "deliverables/eval-scorecard.json",
      "deliverables/final/README.md",
    ],
    route: "reasoning",
    budgetWeight: 0.02,
    staleAfterMinutes: 45,
  },
]

function routeFor(input: OperationScheduleInput, route: string) {
  return (
    input.modelRoutes?.[route] ??
    (route === "small"
      ? "openai/gpt-5.4-mini-fast"
      : route === "throughput"
        ? "opencode-go/default"
        : "openai/gpt-5.5-fast")
  )
}

function fallbackRoutesFor(input: OperationScheduleInput, route: string, primary: string) {
  const defaults =
    route === "throughput"
      ? ["openai/gpt-5.4-mini-fast", "openai/gpt-5.5-fast"]
      : route === "small"
        ? ["opencode-go/default", "openai/gpt-5.5-fast"]
        : ["openai/gpt-5.4-mini-fast", "opencode-go/default"]
  return [...new Set([...(input.fallbackModelRoutes?.[route] ?? defaults)].filter((item) => item !== primary))]
}

export function buildOperationGraph(input: OperationScheduleInput): OperationGraphRecord {
  const operationID = slug(input.operationID, "operation")
  const budgetUSD = input.budgetUSD
  const now = new Date().toISOString()
  return {
    operationID,
    safetyMode: input.safetyMode ?? "non_destructive",
    trustLevel: input.trustLevel ?? "moderate",
    scanProfile: input.scanProfile ?? "balanced",
    maxConcurrentLanes: input.maxConcurrentLanes ?? 4,
    createdAt: now,
    updatedAt: now,
    lanes: BASE_LANES.map((lane) => {
      const modelRoute = routeFor(input, lane.route)
      return {
        id: lane.id,
        title: lane.title,
        agent: lane.agent,
        status: lane.dependsOn.length ? "pending" : "ready",
        dependsOn: [...lane.dependsOn],
        modelRoute,
        fallbackModelRoutes: fallbackRoutesFor(input, lane.route, modelRoute),
        allowedTools: [...lane.allowedTools],
        expectedArtifacts: [...lane.expectedArtifacts],
        budget: budgetUSD !== undefined ? { maxUSD: Number((budgetUSD * lane.budgetWeight).toFixed(4)) } : {},
        restartPolicy: {
          restartable: true,
          maxAttempts: 2,
          staleAfterMinutes: lane.staleAfterMinutes,
        },
        operationID,
      }
    }),
  }
}

export function validateOperationGraph(graph: OperationGraphRecord) {
  const gaps: string[] = []
  const ids = new Set(graph.lanes.map((lane) => lane.id))
  for (const required of REQUIRED_OPERATION_LANES) {
    if (!ids.has(required)) gaps.push(`missing required lane: ${required}`)
  }
  if (graph.safetyMode !== "non_destructive" && graph.safetyMode !== "interactive_destructive") {
    gaps.push("safetyMode must be non_destructive or interactive_destructive")
  }
  if (!["guided", "moderate", "unattended", "lab_full"].includes(graph.trustLevel)) {
    gaps.push("trustLevel must be guided, moderate, unattended, or lab_full")
  }
  if (!["paranoid", "stealth", "balanced", "aggressive", "lab-insane"].includes(graph.scanProfile)) {
    gaps.push("scanProfile must be paranoid, stealth, balanced, aggressive, or lab-insane")
  }
  if (graph.safetyMode === "non_destructive") {
    for (const lane of graph.lanes) {
      if (lane.allowedTools.includes("shell")) gaps.push(`${lane.id}: non_destructive lanes must use command_supervise instead of raw shell`)
    }
  }
  if (graph.maxConcurrentLanes < 1) gaps.push("maxConcurrentLanes must be at least 1")
  for (const lane of graph.lanes) {
    for (const dependency of lane.dependsOn) {
      if (!ids.has(dependency)) gaps.push(`${lane.id}: depends on missing lane ${dependency}`)
    }
    if (!lane.modelRoute.includes("/")) gaps.push(`${lane.id}: modelRoute must include provider/model`)
    if (!lane.fallbackModelRoutes?.length) gaps.push(`${lane.id}: fallbackModelRoutes required`)
    for (const fallback of lane.fallbackModelRoutes ?? []) {
      if (!fallback.includes("/")) gaps.push(`${lane.id}: fallbackModelRoute must include provider/model`)
      if (fallback === lane.modelRoute) gaps.push(`${lane.id}: fallbackModelRoutes must not repeat primary route`)
    }
    if (!lane.expectedArtifacts.length) gaps.push(`${lane.id}: expectedArtifacts required`)
    if (!lane.allowedTools.length) gaps.push(`${lane.id}: allowedTools required`)
  }
  return gaps
}

function markdown(graph: OperationGraphRecord) {
  return [
    `# Operation Graph: ${graph.operationID}`,
    "",
    `- safety_mode: ${graph.safetyMode}`,
    `- trust_level: ${graph.trustLevel}`,
    `- scan_profile: ${graph.scanProfile}`,
    `- max_concurrent_lanes: ${graph.maxConcurrentLanes}`,
    "",
    "## Lanes",
    "",
    ...graph.lanes.flatMap((lane) => [
      `### ${lane.id}`,
      "",
      `- title: ${lane.title}`,
      `- agent: ${lane.agent}`,
      `- status: ${lane.status}`,
      `- depends_on: ${lane.dependsOn.length ? lane.dependsOn.join(", ") : "none"}`,
      `- model_route: ${lane.modelRoute}`,
      `- fallback_model_routes: ${lane.fallbackModelRoutes.length ? lane.fallbackModelRoutes.join(", ") : "none"}`,
      `- max_usd: ${lane.budget.maxUSD ?? "not set"}`,
      `- stale_after_minutes: ${lane.restartPolicy.staleAfterMinutes}`,
      `- allowed_tools: ${lane.allowedTools.join(", ")}`,
      `- expected_artifacts: ${lane.expectedArtifacts.join(", ")}`,
      "",
    ]),
  ].join("\n")
}

export async function writeOperationGraph(worktree: string, input: OperationScheduleInput) {
  const graph = buildOperationGraph(input)
  const gaps = validateOperationGraph(graph)
  if (gaps.length) throw new Error(gaps.join("; "))
  const root = operationPath(worktree, graph.operationID)
  const json = path.join(root, "plans", "operation-graph.json")
  const md = path.join(root, "plans", "operation-graph.md")
  await fs.mkdir(path.dirname(json), { recursive: true })
  await fs.writeFile(json, JSON.stringify(graph, null, 2) + "\n")
  await fs.writeFile(md, markdown(graph))
  return { operationID: graph.operationID, json, markdown: md, lanes: graph.lanes.length }
}
