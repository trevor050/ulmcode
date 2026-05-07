import fs from "fs/promises"
import path from "path"
import { operationPath, readOperationStatus, slug, type OperationStatusSummary } from "./artifact"
import { readOperationPlanExcerpt, type OperationPlanExcerpt } from "./operation-context"
import { readOperationGoal, type OperationGoalRecord } from "./operation-goal"
import { effectiveULMContinuation, readULMConfig } from "./config"

export type OperationSupervisorReviewKind =
  | "startup"
  | "heartbeat"
  | "pre_compaction"
  | "post_compaction"
  | "pre_handoff"
  | "turn_end"
  | "reporting_gate"
  | "operator_timeout"
  | "manual"

export type OperationSupervisorAction =
  | "continue"
  | "continue_execution"
  | "reporting_ready"
  | "ask_question"
  | "recover"
  | "schedule"
  | "queue_work"
  | "compact"
  | "pause"
  | "handoff_ready"
  | "blocked_for_operator"
  | "blocked"

export type OperationSupervisorDecision = {
  action: OperationSupervisorAction
  reason: string
  requiredNextTool?: string
  requiredArtifacts: string[]
  operatorMessage: string
  modelPrompt: string
}

export type OperationSupervisorReview = {
  operationID: string
  reviewKind: OperationSupervisorReviewKind
  generatedAt: string
  goal?: OperationGoalRecord
  status: OperationStatusSummary
  planExcerpt?: OperationPlanExcerpt
  latestAssistantMessage?: string
  decisions: OperationSupervisorDecision[]
  files?: {
    json: string
    markdown: string
  }
}

export type OperationSupervisorInput = {
  operationID: string
  reviewKind?: OperationSupervisorReviewKind
  maxActions?: number
  writeArtifacts?: boolean
  latestAssistantMessage?: string
}

type OperationGraphLike = {
  lanes?: Array<{ id?: string; status?: string; activeJobs?: Array<{ status?: string }> }>
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function decision(input: OperationSupervisorDecision) {
  return input
}

function hasRuntimeBlindSpot(status: OperationStatusSummary) {
  return status.runtime?.notes?.some((note) => note.toLowerCase().includes("runtime blind spot")) ?? false
}

function hasStaleOrFailedLane(graph: OperationGraphLike | undefined) {
  return (
    graph?.lanes?.some(
      (lane) =>
        lane.status === "failed" ||
        lane.status === "blocked" ||
        lane.activeJobs?.some((job) => job.status === "stale" || job.status === "error" || job.status === "cancelled"),
    ) ?? false
  )
}

function graphIncomplete(status: OperationStatusSummary) {
  return (
    (status.graph?.lanes.incomplete.length ?? 0) > 0 ||
    (status.graph?.lanes.missingProofs.length ?? 0) > 0 ||
    (status.graph?.lanes.invalidProofs.length ?? 0) > 0 ||
    (status.graph?.lanes.running.length ?? 0) > 0
  )
}

function longRunGoal(goal: OperationGoalRecord | undefined) {
  return (goal?.targetDurationHours ?? 0) >= 8
}

function decisionsFor(input: {
  reviewKind: OperationSupervisorReviewKind
  goal?: OperationGoalRecord
  status: OperationStatusSummary
  graph?: OperationGraphLike
  finalArtifacts: { operationAudit: boolean; handoffGate: boolean }
}) {
  const decisions: OperationSupervisorDecision[] = []
  if (!input.goal) {
    decisions.push(
      decision({
        action: "blocked",
        reason: "operation goal is missing",
        requiredNextTool: "operation_goal",
        requiredArtifacts: ["goals/operation-goal.json"],
        operatorMessage: "Create a durable operation goal before broad execution.",
        modelPrompt: "Call operation_goal with action=create using the authorized objective and target duration.",
      }),
    )
  }
  if (!input.status.plans.operation) {
    decisions.push(
      decision({
        action: "blocked",
        reason: "operation plan is missing",
        requiredNextTool: "operation_plan",
        requiredArtifacts: ["plans/operation-plan.json"],
        operatorMessage: "Write the durable operation plan before scheduling or launching broad work.",
        modelPrompt: "Call operation_plan with ordered phases, success criteria, subagent policy, supervisor handoff, and report closeout.",
      }),
    )
  }
  if (hasStaleOrFailedLane(input.graph)) {
    decisions.push(
      decision({
        action: "recover",
        reason: "operation graph contains failed, blocked, stale, errored, or cancelled lane work",
        requiredNextTool: "operation_resume",
        requiredArtifacts: ["plans/operation-graph.json", "background job metadata"],
        operatorMessage: "Recover restartable stale or failed lanes before launching duplicate work.",
        modelPrompt: "Call operation_resume with recoverStaleTasks=true, or call operation_recover for the operation.",
      }),
    )
  }
  if (longRunGoal(input.goal) && input.graph && !input.graph.lanes?.some((lane) => lane.id === "supervisor")) {
    decisions.push(
      decision({
        action: "schedule",
        reason: "long-run graph has no supervisor lane",
        requiredNextTool: "operation_schedule",
        requiredArtifacts: ["plans/operation-graph.json"],
        operatorMessage: "Regenerate or extend the lane graph so long runs have a supervisor lane.",
        modelPrompt: "Update the schedule so a supervisor lane reviews goal drift, stale work, runtime budget, evidence gaps, and handoff readiness.",
      }),
    )
  }
  if (input.status.graph?.exists && graphIncomplete(input.status)) {
    decisions.push(
      decision({
        action: "continue_execution",
        reason: "operation graph has incomplete lanes or missing lane proof",
        requiredNextTool: "operation_run",
        requiredArtifacts: ["plans/operation-graph.json", "lane-complete/"],
        operatorMessage: "Continue execution until every planned lane is complete or explicitly skipped with proof.",
        modelPrompt: "Call operation_run or operation_next, then advance the next incomplete lane with task background=true or command_supervise.",
      }),
    )
  }
  if (hasRuntimeBlindSpot(input.status)) {
    decisions.push(
      decision({
        action: "blocked",
        reason: "runtime summary records a blind spot",
        requiredNextTool: "runtime_summary",
        requiredArtifacts: ["deliverables/runtime-summary.json"],
        operatorMessage: "Resolve runtime accounting blind spots before final handoff.",
        modelPrompt: "Regenerate runtime_summary with background task/session usage or explicitly document unrecoverable blind spots.",
      }),
    )
  }
  if (input.status.findings.byState.candidate > 0 || input.status.findings.byState.needs_validation > 0) {
    decisions.push(
      decision({
        action: "queue_work",
        reason: "candidate or needs-validation findings remain",
        requiredNextTool: "finding_record",
        requiredArtifacts: ["findings/", "evidence/"],
        operatorMessage: "Validate, reject, or queue remaining candidate findings before final reporting.",
        modelPrompt: "Use validator/evidence lanes to promote evidence-backed findings or reject weak claims.",
      }),
    )
  }
  const executionReadyForReporting =
    input.status.plans.operation &&
    !graphIncomplete(input.status) &&
    !hasStaleOrFailedLane(input.graph) &&
    input.status.findings.byState.candidate === 0 &&
    input.status.findings.byState.needs_validation === 0
  if (
    executionReadyForReporting &&
    (!input.status.reports.outline ||
      (!input.status.reports.markdown && !input.status.reports.html) ||
      !input.status.reports.manifest ||
      !input.status.runtimeSummary ||
      !input.finalArtifacts.operationAudit ||
      !input.finalArtifacts.handoffGate)
  ) {
    decisions.push(
      decision({
        action: "reporting_ready",
        reason: "execution lanes are ready for the reporting and audit pipeline",
        requiredNextTool: "report_outline",
        requiredArtifacts: [
          "reports/report-outline.md",
          "reports/report.md or reports/report.html",
          "deliverables/final/manifest.json",
          "deliverables/runtime-summary.json",
          "deliverables/operation-audit.json",
          "deliverables/stage-gates/handoff.json",
        ],
        operatorMessage: "Start the report closeout pipeline before handoff.",
        modelPrompt:
          "Run report_outline, evidence_normalize if needed, report writer, technical and executive review, report_lint, report_render, runtime_summary, eval_scorecard for benchmark/readiness runs, operation_audit, then operation_stage_gate for handoff.",
      }),
    )
  }
  if (
    input.reviewKind === "pre_handoff" &&
    input.goal?.status === "complete" &&
    input.status.runtimeSummary &&
    input.status.reports.manifest &&
    input.finalArtifacts.operationAudit &&
    input.finalArtifacts.handoffGate &&
    !hasRuntimeBlindSpot(input.status)
  ) {
    decisions.push(
      decision({
        action: "handoff_ready",
        reason: "goal is complete and final runtime/report artifacts are present",
        requiredArtifacts: ["goals/operation-goal.json", "deliverables/runtime-summary.json", "deliverables/final/manifest.json"],
        operatorMessage: "Final handoff appears ready. Confirm operation_audit remains clean before stopping.",
        modelPrompt: "Call operation_audit with finalHandoff=true if it has not already passed in this handoff cycle.",
      }),
    )
  }
  if (!decisions.length && input.reviewKind === "operator_timeout") {
    decisions.push(
      decision({
        action: "blocked_for_operator",
        reason: "operator prompt timed out and fallback policy denied or answered conservatively",
        requiredArtifacts: ["operator-timeouts/"],
        operatorMessage: "Operator input was unavailable; stay within the existing authorized scope.",
        modelPrompt: "Do not retry the same blocked ask. Continue with safe in-scope work, or pause only if no safe bounded work remains.",
      }),
    )
  }
  if (!decisions.length) {
    decisions.push(
      decision({
        action: input.reviewKind === "turn_end" ? "continue_execution" : "continue",
        reason: "no supervisor blockers found",
        requiredNextTool: "operation_run",
        requiredArtifacts: ["plans/operation-run.jsonl"],
        operatorMessage: "Continue with the next scheduled operation lane.",
        modelPrompt: "Call operation_run or operation_next and launch the next bounded lane through task or command_supervise.",
      }),
    )
  }
  return decisions
}

function reviewMarkdown(review: OperationSupervisorReview) {
  return [
    `# Supervisor Review ${review.operationID}`,
    "",
    `review_kind: ${review.reviewKind}`,
    `generated_at: ${review.generatedAt}`,
    `goal_status: ${review.goal?.status ?? "missing"}`,
    `operation_stage: ${review.status.operation?.stage ?? "unknown"}`,
    `operation_status: ${review.status.operation?.status ?? "unknown"}`,
    review.planExcerpt
      ? `plan_excerpt: path=${review.planExcerpt.path ?? "missing"} chars=${review.planExcerpt.chars} max_chars=${review.planExcerpt.maxChars} truncated=${review.planExcerpt.truncated}`
      : undefined,
    review.latestAssistantMessage ? `latest_assistant_message: ${review.latestAssistantMessage.slice(0, 500)}` : undefined,
    "",
    "## Decisions",
    "",
    ...review.decisions.map((item) =>
      [
        `- action: ${item.action}`,
        `  reason: ${item.reason}`,
        item.requiredNextTool ? `  next_tool: ${item.requiredNextTool}` : undefined,
        `  operator: ${item.operatorMessage}`,
        `  model: ${item.modelPrompt}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
    ),
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

async function writeReview(worktree: string, review: OperationSupervisorReview) {
  const dir = path.join(operationPath(worktree, review.operationID), "supervisor")
  const stamp = review.generatedAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "")
  const files = {
    json: path.join(dir, `supervisor-review-${stamp}.json`),
    markdown: path.join(dir, "latest.md"),
  }
  const persisted = { ...review, files }
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(files.json, JSON.stringify(persisted, null, 2) + "\n")
  await fs.writeFile(files.markdown, reviewMarkdown(persisted))
  return persisted
}

export async function superviseOperation(
  worktree: string,
  input: OperationSupervisorInput,
  options: { now?: string } = {},
): Promise<OperationSupervisorReview> {
  const operationID = slug(input.operationID, "operation")
  const status = await readOperationStatus(worktree, operationID)
  const goal = (await readOperationGoal(worktree, operationID)).goal
  const continuation = goal ? effectiveULMContinuation(goal, await readULMConfig({ directory: worktree, worktree })) : undefined
  const root = operationPath(worktree, operationID)
  const graph = await readJson<OperationGraphLike>(path.join(root, "plans", "operation-graph.json"))
  const finalArtifacts = {
    operationAudit: !!(await readJson(path.join(root, "deliverables", "operation-audit.json"))),
    handoffGate: !!(await readJson(path.join(root, "deliverables", "stage-gates", "handoff.json"))),
  }
  const review: OperationSupervisorReview = {
    operationID,
    reviewKind: input.reviewKind ?? "manual",
    generatedAt: options.now ?? new Date().toISOString(),
    goal,
    status,
    planExcerpt: await readOperationPlanExcerpt(worktree, operationID, continuation?.injectPlanMaxChars ?? 12_000),
    latestAssistantMessage: input.latestAssistantMessage,
    decisions: decisionsFor({ reviewKind: input.reviewKind ?? "manual", goal, status, graph, finalArtifacts }).slice(
      0,
      input.maxActions ?? 5,
    ),
  }
  if (input.writeArtifacts === false) return review
  return writeReview(worktree, review)
}
