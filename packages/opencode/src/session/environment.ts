import fs from "fs/promises"
import path from "path"
import z from "zod"
import type { MessageV2 } from "./message-v2"
import type { Session } from "./index"
import { Instance } from "@/project/instance"

export namespace CyberEnvironment {
  export const SKILL_REMINDER_MARKER = "[CYBER_SKILL_REMINDER_V1]"
  export const REPORT_WRITER_REQUIRED_MARKER = "[CYBER_REPORT_WRITER_REQUIRED_V1]"
  export const REPORT_WRITER_SKILL_MARKER = "[REPORT_WRITER_SKILL_REQUIRED_V1]"

  const CYBER_AGENTS = new Set([
    "pentest",
    "recon",
    "assess",
    "report",
    "analyst",
    "report_writer",
    "network_mapper",
    "host_auditor",
    "vuln_researcher",
    "evidence_scribe",
  ])

  export const Info = z.object({
    type: z.literal("cyber"),
    root: z.string(),
    engagementID: z.string(),
    created: z.number(),
    scaffoldVersion: z.literal("v1"),
    rootSessionID: z.string(),
  })
  export type Info = z.infer<typeof Info>

  function shortSessionID(sessionID: string) {
    const normalized = sessionID.replace(/^session_/, "")
    return normalized.slice(0, 8)
  }

  function buildEngagementID(input: { created: number; rootSessionID: string }) {
    const date = new Date(input.created).toISOString().slice(0, 10)
    return `${date}-${shortSessionID(input.rootSessionID)}`
  }

  export function isCyberAgent(agentName: string | undefined) {
    if (!agentName) return false
    return CYBER_AGENTS.has(agentName)
  }

  export function rootBase() {
    return path.join(Instance.directory, "engagements")
  }

  export function legacyHiddenRootBase() {
    return path.join(Instance.directory, ".opencode", "engagements")
  }

  export function create(session: Session.Info, rootSessionID?: string): Info {
    const rootID = rootSessionID ?? session.id
    const engagementID = buildEngagementID({
      created: session.time.created,
      rootSessionID: rootID,
    })
    return {
      type: "cyber",
      root: path.join(rootBase(), engagementID),
      engagementID,
      created: Date.now(),
      scaffoldVersion: "v1",
      rootSessionID: rootID,
    }
  }

  function findingHeader(sessionID: string, now: string) {
    return [
      "# Engagement Findings",
      "",
      `- Session: ${sessionID}`,
      `- Started: ${now}`,
      "",
      "## Findings",
      "",
      "_Append each validated finding below with timestamp, asset, severity, confidence, evidence, impact, and remediation._",
      "",
    ].join("\n")
  }

  function engagementHeader(sessionID: string, now: string) {
    return [
      "# Engagement",
      "",
      `- Session: ${sessionID}`,
      `- Created: ${now}`,
      "",
      "## Scope",
      "- TODO",
      "",
      "## Authorization",
      "- TODO",
      "",
      "## Notes",
      "- TODO",
      "",
    ].join("\n")
  }

  function handoffHeader(now: string) {
    return [
      "# Handoff",
      "",
      `- Created: ${now}`,
      "",
      "## Coordination Notes",
      "- Record cross-agent dependencies and updates here.",
      "",
    ].join("\n")
  }

  function engagementReadme(input: { environment: Info; session: Session.Info }) {
    const root = input.environment.root
    const childPrefix = path.join(root, "agents")
    return [
      "# Engagement Workspace",
      "",
      `- Engagement ID: ${input.environment.engagementID}`,
      `- Session: ${input.session.id}`,
      "",
      "## Audit Quickstart",
      `- Findings log: ${path.join(root, "finding.md")}`,
      `- Cross-agent handoff: ${path.join(root, "handoff.md")}`,
      `- Reports: ${path.join(root, "reports")}`,
      `- Raw evidence: ${path.join(root, "evidence", "raw")}`,
      `- Processed evidence: ${path.join(root, "evidence", "processed")}`,
      "",
      "## Subagent Outputs",
      `- Per-subagent summaries: ${path.join(childPrefix, "<subagent-session-id>", "results.md")}`,
      "",
    ].join("\n")
  }

  async function writeIfMissing(file: string, content: string) {
    await fs.writeFile(file, content, { flag: "wx" }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return
      throw error
    })
  }

  async function ensureSymlink(input: { link: string; target: string }) {
    const existing = await fs.lstat(input.link).catch(() => undefined)
    if (existing?.isSymbolicLink()) {
      const current = await fs.readlink(input.link).catch(() => "")
      if (current === input.target) return
      await fs.unlink(input.link)
    } else if (existing) {
      return
    }
    await fs.symlink(input.target, input.link, process.platform === "win32" ? "junction" : "dir").catch(() => {})
  }

  function normalizeEnvironmentRoot(environment: Info): Info {
    const hidden = legacyHiddenRootBase()
    const visible = rootBase()
    if (!environment.root.startsWith(hidden)) return environment
    const suffix = path.relative(hidden, environment.root)
    return {
      ...environment,
      root: path.join(visible, suffix),
    }
  }

  async function migrateLegacyEngagementRoot() {
    const hidden = legacyHiddenRootBase()
    const visible = rootBase()
    await fs.mkdir(path.dirname(hidden), { recursive: true })

    const visibleStat = await fs.lstat(visible).catch(() => undefined)
    if (visibleStat?.isSymbolicLink()) {
      await fs.unlink(visible).catch(() => {})
    }
    await fs.mkdir(visible, { recursive: true }).catch(() => {})

    const hiddenStat = await fs.lstat(hidden).catch(() => undefined)
    if (hiddenStat?.isDirectory() && !hiddenStat.isSymbolicLink()) {
      const entries = await fs.readdir(hidden)
      for (const entry of entries) {
        const from = path.join(hidden, entry)
        const to = path.join(visible, entry)
        const exists = await fs.lstat(to).catch(() => undefined)
        if (exists) continue
        await fs.rename(from, to).catch(() => {})
      }
      await fs.rmdir(hidden).catch(() => {})
    }

    await ensureSymlink({
      link: hidden,
      target: visible,
    })
  }

  async function ensureVisibleEntryPoints(input: { environment: Info }) {
    await migrateLegacyEngagementRoot()
    await ensureSymlink({
      link: path.join(rootBase(), "latest"),
      target: input.environment.root,
    })
  }

  export async function ensureSharedScaffold(input: { environment: Info; session: Session.Info }) {
    const root = input.environment.root
    const now = new Date().toISOString()
    await ensureVisibleEntryPoints({ environment: input.environment })
    await fs.mkdir(path.join(root, "evidence", "raw"), { recursive: true })
    await fs.mkdir(path.join(root, "evidence", "processed"), { recursive: true })
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.mkdir(path.join(root, "tmp"), { recursive: true })
    await fs.mkdir(path.join(root, "agents"), { recursive: true })

    await writeIfMissing(path.join(root, "finding.md"), findingHeader(input.session.id, now))
    await writeIfMissing(path.join(root, "engagement.md"), engagementHeader(input.session.id, now))
    await writeIfMissing(path.join(root, "handoff.md"), handoffHeader(now))
    await writeIfMissing(path.join(root, "README.md"), engagementReadme(input))
    await writeIfMissing(
      path.join(root, "run-metadata.json"),
      JSON.stringify(
        {
          session_id: input.session.id,
          environment: {
            type: input.environment.type,
            engagement_id: input.environment.engagementID,
            root_session_id: input.environment.rootSessionID,
            scaffold_version: input.environment.scaffoldVersion,
          },
          generated_at: now,
        },
        null,
        2,
      ) + "\n",
    )
  }

  export async function ensureSubagentWorkspace(input: { environment: Info; session: Session.Info }) {
    const root = path.join(input.environment.root, "agents", input.session.id)
    const now = new Date().toISOString()
    await fs.mkdir(path.join(root, "tmp"), { recursive: true })
    await fs.mkdir(path.join(root, "evidence"), { recursive: true })
    await writeIfMissing(
      path.join(root, "results.md"),
      [
        "# Subagent Results",
        "",
        `- Session: ${input.session.id}`,
        `- Created: ${now}`,
        "",
        "## Summary",
        "- TODO",
        "",
        "## Evidence Links",
        "- TODO",
        "",
      ].join("\n"),
    )
    return root
  }

  export async function ensureSharedEnvironment(input: {
    session: Session.Info
    agentName?: string
    parentEnvironment?: Info
    force?: boolean
  }) {
    if (!input.force && !isCyberAgent(input.agentName)) {
      return { environment: undefined, created: false as const }
    }
    const source = input.session.environment ?? input.parentEnvironment ?? create(input.session)
    const environment = normalizeEnvironmentRoot(source)
    await ensureSharedScaffold({ environment, session: input.session })
    return {
      environment,
      created: !input.session.environment,
      changed: source.root !== environment.root,
    }
  }

  export function resolveFindingPath(session: Session.Info) {
    if (session.environment?.type === "cyber") return path.join(session.environment.root, "finding.md")
    return path.join(session.directory, "finding.md")
  }

  export function resolveReportsDir(session: Session.Info) {
    if (session.environment?.type === "cyber") return path.join(session.environment.root, "reports")
    return undefined
  }

  export function hasLoadedSkill(messages: MessageV2.WithParts[]) {
    return messages.some((message) =>
      message.parts.some(
        (part) => part.type === "tool" && part.tool === "skill" && part.state.status === "completed",
      ),
    )
  }

  export function hasSkillReminderBeenShown(messages: MessageV2.WithParts[]) {
    return messages.some((message) =>
      message.parts.some(
        (part) =>
          part.type === "text" &&
          !!part.synthetic &&
          part.text.includes(SKILL_REMINDER_MARKER),
      ),
    )
  }

  export function hasReportWriterRun(messages: MessageV2.WithParts[]) {
    return messages.some((message) =>
      message.parts.some((part) => {
        if (part.type !== "tool") return false
        if (part.tool !== "task") return false
        if (part.state.status === "pending") return false
        return part.state.input?.subagent_type === "report_writer"
      }),
    )
  }

  export function hasCompletedCyberSubtask(messages: MessageV2.WithParts[]) {
    return messages.some((message) =>
      message.parts.some((part) => {
        if (part.type !== "tool") return false
        if (part.tool !== "task") return false
        if (part.state.status !== "completed") return false
        const agent = part.state.input?.subagent_type
        return isCyberAgent(typeof agent === "string" ? agent : undefined) && agent !== "report_writer"
      }),
    )
  }

  export function hasReminderMarker(messages: MessageV2.WithParts[], marker: string) {
    return messages.some((message) =>
      message.parts.some((part) => part.type === "text" && !!part.synthetic && part.text.includes(marker)),
    )
  }
}
