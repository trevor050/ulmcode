import { Context, Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { activeOperationGoal, readOperationPlanExcerpt } from "@/ulm/operation-context"
import { effectiveULMContinuation, readULMConfig } from "@/ulm/config"
import { operatorFallbackTimeoutMillis } from "@/ulm/operator-timeout"

type OperationGoalContext = {
  operationID: string
  objective: string
  targetDurationHours?: number
  status?: string
  createdAt?: string
  updatedAt?: string
}

type SupervisorReviewContext = {
  generatedAt?: string
  decisions?: Array<{
    action?: string
    reason?: string
    requiredNextTool?: string
  }>
}

type ToolInventoryContext = {
  counts?: {
    total?: number
    installed?: number
    missing?: number
    highValueMissing?: number
  }
  tools?: Array<{
    id?: string
    installed?: boolean
    highValue?: boolean
  }>
  nextActions?: string[]
}

function short(value: string | undefined, max: number) {
  const text = value?.trim().replace(/\s+/g, " ")
  if (!text) return undefined
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return undefined
  }
}

function parseTime(value: string | undefined) {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

async function latestSupervisorReview(worktree: string, operationID: string) {
  const dir = path.join(worktree, ".ulmcode", "operations", operationID, "supervisor")
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return undefined
  }
  const reviews = (
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith("supervisor-review-") && entry.endsWith(".json"))
        .map((entry) => readJson<SupervisorReviewContext>(path.join(dir, entry))),
    )
  )
    .filter((review): review is SupervisorReviewContext => !!review)
    .sort((a, b) => parseTime(b.generatedAt) - parseTime(a.generatedAt))
  return reviews[0]
}

async function toolInventory(worktree: string, operationID: string) {
  return readJson<ToolInventoryContext>(path.join(worktree, ".ulmcode", "operations", operationID, "tool-inventory", "tool-inventory.json"))
}

async function ulmOperationContext(worktree: string) {
  const active = await activeOperationGoal(worktree)
  if (!active) return undefined
  const goal = active.goal
  const config = await readULMConfig({ directory: worktree, worktree })
  const continuation = effectiveULMContinuation(goal, config)
  const operatorTimeoutMillis = operatorFallbackTimeoutMillis(goal, config)
  const maxPlanChars = continuation.injectPlanMaxChars
  const supervisor = await latestSupervisorReview(worktree, goal.operationID)
  const inventory = await toolInventory(worktree, goal.operationID)
  const plan = await readOperationPlanExcerpt(worktree, goal.operationID, maxPlanChars)
  const decision = supervisor?.decisions?.[0]
  const installed = inventory?.tools?.filter((tool) => tool.installed && tool.highValue).map((tool) => tool.id).filter(Boolean).slice(0, 8)
  const missing = inventory?.tools?.filter((tool) => !tool.installed && tool.highValue).map((tool) => tool.id).filter(Boolean).slice(0, 8)
  return [
    "<ulm_operation_context>",
    `operation: ${goal.operationID}`,
    `objective: ${short(goal.objective, 220) ?? "unknown"}`,
    goal.targetDurationHours === undefined ? undefined : `target_duration_hours: ${goal.targetDurationHours}`,
    `status: ${goal.status ?? "active"}`,
    decision
      ? `supervisor: action=${decision.action ?? "unknown"} reason=${short(decision.reason, 160) ?? "none"} next_tool=${decision.requiredNextTool ?? "none"}`
      : "supervisor: no review yet; use operation_supervise when progress stalls, before compaction, and before handoff",
    inventory
      ? `tool_inventory: installed=${inventory.counts?.installed ?? 0}/${inventory.counts?.total ?? 0} high_value_missing=${inventory.counts?.highValueMissing ?? 0}`
      : "tool_inventory: missing; call tool_inventory before broad discovery",
    installed?.length ? `installed_high_value: ${installed.join(", ")}` : undefined,
    missing?.length ? `missing_high_value: ${missing.join(", ")}` : undefined,
    inventory?.nextActions?.[0] ? `inventory_next: ${short(inventory.nextActions[0], 180)}` : undefined,
    "foreground_command_policy: commands expected over 2 minutes must use command_supervise, task background=true, runtime_scheduler, or runtime_daemon instead of foreground waiting",
    "operator_availability_policy: assume the operator is unavailable after execution starts; do not wait for new operator input, honor the original authorized scope, work around ambiguity with conservative skip/decline defaults, and write durable notes",
    operatorTimeoutMillis === undefined
      ? "unattended_operator_policy: operator timeout disabled by ULMconfig.toml; wait indefinitely for permission/question prompts"
      : `unattended_operator_policy: after ${Math.round(operatorTimeoutMillis / 1000)}s, permission/question prompts default safely; do not block waiting for operator`,
    `ulm_config: continuation_enabled=${continuation.enabled} turn_end_review=${continuation.turnEndReview} max_no_tool_continuation_turns=${continuation.maxNoToolContinuationTurns} inject_plan_max_chars=${continuation.injectPlanMaxChars} operator_fallback_enabled=${continuation.operatorFallbackEnabled} max_repeated_operator_timeouts_per_kind=${continuation.maxRepeatedOperatorTimeoutsPerKind}`,
    "</ulm_operation_context>",
    plan.content
      ? [
          `<ulm_operation_plan max_chars="${plan.maxChars}" chars="${plan.chars}" truncated="${plan.truncated}" path="${plan.path ?? ""}">`,
          plan.content,
          "</ulm_operation_plan>",
        ].join("\n")
      : `<ulm_operation_plan max_chars="${plan.maxChars}" missing="true"></ulm_operation_plan>`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        const operationContext = yield* Effect.promise(async () => (await ulmOperationContext(ctx.worktree)) ?? (await ulmOperationContext(ctx.directory)))
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
            ``,
            operationContext ? `${operationContext}\n` : undefined,
            `System safety: never run broad commands that kill every Node.js process, such as \`pkill node\`, \`killall node\`, \`taskkill /F /IM node.exe\`, or \`Get-Process node | Stop-Process\`. OpenCode itself runs on Node.js, so stop specific PIDs or use project-scoped commands such as \`npm stop\` or \`pm2 stop <name>\`.`,
          ]
            .filter((line): line is string => line !== undefined)
            .join("\n"),
        ]
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
