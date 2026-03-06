import fs from "fs/promises"
import path from "path"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { CyberEnvironment } from "./environment"
import { BackgroundAgentManager } from "@/features/background-agent/manager"

const FETCH_LIKE_TOOL_PATTERNS = [/^web_/, /^browser_/, /^mcp_/, /^fetch$/, /^open$/, /^read$/, /^search$/]

function isFetchLikeTool(tool: string) {
  return FETCH_LIKE_TOOL_PATTERNS.some((pattern) => pattern.test(tool))
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function countBytes(text: string | undefined) {
  return Buffer.byteLength(text ?? "", "utf8")
}

async function resolveRootSession(session: Session.Info) {
  let cursor = session
  const visited = new Set<string>()
  while (cursor.parentID && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    const parent = await Session.get(cursor.parentID).catch(() => undefined)
    if (!parent) break
    cursor = parent
  }
  return cursor
}

async function collectSessionTree(rootSessionID: string) {
  const root = await Session.get(rootSessionID)
  const all: Session.Info[] = []
  if (!root) return all
  const queue = [root]
  while (queue.length) {
    const current = queue.shift()!
    all.push(current)
    const children = await Session.children(current.id)
    queue.push(...children)
  }
  return all
}

async function readCoordinationClaims(rootSession: Session.Info) {
  const dir = CyberEnvironment.resolveCoordinationDir(rootSession)
  if (!dir) return { active: 0, completed: 0, released: 0, failed: 0, claimed: [] as string[] }
  const file = path.join(dir, "task-graph.json")
  const graph = await fs
    .readFile(file, "utf8")
    .then((x) => JSON.parse(x) as { claims?: Record<string, { status?: string }> })
    .catch(() => ({ claims: {} }))
  const claims = Object.entries(graph.claims ?? {})
  return {
    active: claims.filter(([, value]) => value?.status === "claimed").length,
    completed: claims.filter(([, value]) => value?.status === "completed").length,
    released: claims.filter(([, value]) => value?.status === "released").length,
    failed: claims.filter(([, value]) => value?.status === "failed").length,
    claimed: claims.filter(([, value]) => value?.status === "claimed").map(([key]) => key),
  }
}

function makeMarkdown(summary: Awaited<ReturnType<typeof collect>>) {
  const repeatedFetchLines =
    summary.tooling.repeated_fetch_tools.length > 0
      ? summary.tooling.repeated_fetch_tools.map((item) => `- ${item.tool}: ${item.calls} calls`)
      : ["- none"]
  const backgroundLines =
    summary.background.tasks.length > 0
      ? summary.background.tasks.slice(0, 8).map(
          (task) =>
            `- ${task.id} | ${task.status} | ${task.subagent_type} | ${task.description}${task.duration_ms ? ` | ${task.duration_ms}ms` : ""}`,
        )
      : ["- none"]
  const activeClaims =
    summary.swarm.active_claims.length > 0 ? summary.swarm.active_claims.map((claim) => `- ${claim}`) : ["- none"]

  return [
    "# Pentest Runtime Summary",
    "",
    `- Generated: ${summary.generated_at}`,
    `- Root session: ${summary.root_session_id}`,
    `- Sessions in tree: ${summary.session_tree.session_count}`,
    "",
    "## Model Usage",
    `- Parent model calls: ${summary.model_usage.parent.calls}`,
    `- Parent tokens: ${summary.model_usage.parent.tokens.total}`,
    `- Subagent model calls: ${summary.model_usage.subagents.calls}`,
    `- Subagent tokens: ${summary.model_usage.subagents.tokens.total}`,
    "",
    "## Context Pressure",
    `- Compactions: ${summary.context.compaction_count}`,
    `- Max pre-compaction tokens seen: ${summary.context.max_pre_compaction_tokens}`,
    "",
    "## Tooling",
    `- Total tool output bytes (raw): ${summary.tooling.total_output_bytes_raw} (${formatBytes(summary.tooling.total_output_bytes_raw)})`,
    `- Total tool output bytes (prompt-visible): ${summary.tooling.total_output_bytes_visible} (${formatBytes(summary.tooling.total_output_bytes_visible)})`,
    `- Summarized tool outputs: ${summary.tooling.summarized_outputs}`,
    `- Truncated handoffs: ${summary.tooling.truncated_handoffs}`,
    "",
    "## Repeated Fetch Activity",
    ...repeatedFetchLines,
    "",
    "## Background Work",
    `- Active: ${summary.background.status_counts.active}`,
    `- Completed: ${summary.background.status_counts.completed}`,
    `- Failed: ${summary.background.status_counts.failed}`,
    `- Cancelled: ${summary.background.status_counts.cancelled}`,
    `- Stale timeout: ${summary.background.status_counts.stale_timeout}`,
    ...backgroundLines,
    "",
    "## Swarm Coordination",
    `- Policy: ${summary.swarm.policy ?? "unknown"}`,
    `- Active claims: ${summary.swarm.active_claims.length}`,
    `- Completed claims: ${summary.swarm.completed_claims}`,
    `- Released claims: ${summary.swarm.released_claims}`,
    `- Failed claims: ${summary.swarm.failed_claims}`,
    ...activeClaims,
    "",
  ].join("\n")
}

async function collect(input: { sessionID: string }) {
  const session = await Session.get(input.sessionID)
  if (!session || session.environment?.type !== "cyber") return undefined
  const rootSession = await resolveRootSession(session)
  const sessions = await collectSessionTree(rootSession.id)
  const sessionIDs = new Set(sessions.map((item) => item.id))
  const messages = await Promise.all(
    sessions.map(async (item) => ({
      session: item,
      messages: await Session.messages({ sessionID: item.id }),
    })),
  )

  const counts = {
    parent: { calls: 0, tokens: { input: 0, output: 0, reasoning: 0, total: 0 } },
    subagents: { calls: 0, tokens: { input: 0, output: 0, reasoning: 0, total: 0 } },
  }
  let compactionCount = 0
  let maxPreCompactionTokens = 0
  let totalOutputBytesRaw = 0
  let totalOutputBytesVisible = 0
  let summarizedOutputs = 0
  let truncatedHandoffs = 0
  const toolCallsByName = new Map<string, number>()

  for (const { session: item, messages: sessionMessages } of messages) {
    const target = item.parentID ? counts.subagents : counts.parent
    for (const msg of sessionMessages) {
      for (const part of msg.parts) {
        if (part.type === "step-finish") {
          target.calls += 1
          target.tokens.input += part.tokens.input
          target.tokens.output += part.tokens.output
          target.tokens.reasoning += part.tokens.reasoning
          target.tokens.total += part.tokens.total ?? part.tokens.input + part.tokens.output + part.tokens.reasoning
          maxPreCompactionTokens = Math.max(
            maxPreCompactionTokens,
            part.tokens.total ?? part.tokens.input + part.tokens.output + part.tokens.reasoning,
          )
        }
        if (part.type === "compaction") {
          compactionCount += 1
        }
        if (part.type !== "tool") continue
        const state = part.state
        const metadata = "metadata" in state ? (state.metadata ?? {}) : {}
        const runtime = metadata.pentest_runtime as
          | {
              raw_output_bytes?: number
              visible_output_bytes?: number
              output_summarized?: boolean
              truncated_handoff?: boolean
            }
          | undefined
        toolCallsByName.set(part.tool, (toolCallsByName.get(part.tool) ?? 0) + 1)
        if (state.status === "completed") {
          totalOutputBytesRaw += runtime?.raw_output_bytes ?? countBytes(state.output)
          totalOutputBytesVisible += runtime?.visible_output_bytes ?? countBytes(state.output)
          if (runtime?.output_summarized) summarizedOutputs += 1
          if (runtime?.truncated_handoff) truncatedHandoffs += 1
        }
      }
    }
  }

  const backgroundTasks = (await BackgroundAgentManager.list({ includeCompleted: true })).filter(
    (task) => sessionIDs.has(task.parentSessionID) || sessionIDs.has(task.sessionID),
  )
  const repeatedFetchTools = [...toolCallsByName.entries()]
    .filter(([tool, calls]) => isFetchLikeTool(tool) && calls > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, calls]) => ({ tool, calls }))
  const policy = await CyberEnvironment.readSwarmPolicy(rootSession)
  const claims = await readCoordinationClaims(rootSession)

  return {
    generated_at: new Date().toISOString(),
    root_session_id: rootSession.id,
    engagement_id: rootSession.environment?.engagementID ?? session.environment.engagementID,
    runtime_paths: {
      json: CyberEnvironment.resolveRuntimeSummaryJsonPath(rootSession),
      markdown: CyberEnvironment.resolveRuntimeSummaryMarkdownPath(rootSession),
    },
    session_tree: {
      session_count: sessions.length,
      session_ids: sessions.map((item) => item.id),
      child_session_ids: sessions.filter((item) => !!item.parentID).map((item) => item.id),
    },
    model_usage: counts,
    context: {
      compaction_count: compactionCount,
      max_pre_compaction_tokens: maxPreCompactionTokens,
    },
    tooling: {
      total_output_bytes_raw: totalOutputBytesRaw,
      total_output_bytes_visible: totalOutputBytesVisible,
      summarized_outputs: summarizedOutputs,
      truncated_handoffs: truncatedHandoffs,
      tool_calls_by_name: Object.fromEntries([...toolCallsByName.entries()].sort((a, b) => b[1] - a[1])),
      repeated_fetch_tools: repeatedFetchTools,
    },
    background: {
      status_counts: {
        active: backgroundTasks.filter((task) => ["queued", "running"].includes(task.status)).length,
        completed: backgroundTasks.filter((task) => task.status === "completed").length,
        failed: backgroundTasks.filter((task) => task.status === "failed").length,
        cancelled: backgroundTasks.filter((task) => task.status === "cancelled").length,
        stale_timeout: backgroundTasks.filter((task) => task.status === "stale_timeout").length,
      },
      tasks: backgroundTasks.map((task) => ({
        id: task.id,
        session_id: task.sessionID,
        parent_session_id: task.parentSessionID,
        subagent_type: task.subagentType,
        description: task.description,
        status: task.status,
        duration_ms: task.durationMs ?? null,
        created_at: new Date(task.createdAt).toISOString(),
      })),
    },
    swarm: {
      policy: policy?.swarm_aggression ?? null,
      policy_source_session_id: policy?.set_by_session_id ?? null,
      active_claims: claims.claimed,
      completed_claims: claims.completed,
      released_claims: claims.released,
      failed_claims: claims.failed,
    },
  }
}

export namespace PentestRuntimeSummary {
  export async function generate(input: { sessionID: string }) {
    return collect(input)
  }

  export async function write(input: { sessionID: string }) {
    const summary = await collect(input)
    if (!summary?.runtime_paths.json || !summary.runtime_paths.markdown) return undefined
    await fs.mkdir(path.dirname(summary.runtime_paths.json), { recursive: true })
    await Promise.all([
      fs.writeFile(summary.runtime_paths.json, JSON.stringify(summary, null, 2) + "\n", "utf8"),
      fs.writeFile(summary.runtime_paths.markdown, makeMarkdown(summary) + "\n", "utf8"),
    ])
    return summary
  }
}
