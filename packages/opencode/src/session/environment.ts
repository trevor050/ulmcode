import fs from "fs/promises"
import path from "path"
import z from "zod"
import type { MessageV2 } from "./message-v2"
import type { Session } from "./index"
import { Instance } from "@/project/instance"
import { Log } from "../util/log"

export namespace CyberEnvironment {
  const log = Log.create({ service: "session.environment" })
  export const SKILL_REMINDER_MARKER = "[CYBER_SKILL_REMINDER_V1]"
  export const REPORT_WRITER_REQUIRED_MARKER = "[CYBER_REPORT_WRITER_REQUIRED_V1]"
  export const REPORT_WRITER_SKILL_MARKER = "[REPORT_WRITER_SKILL_REQUIRED_V1]"

  const CYBER_AGENTS = new Set([
    "action",
    "pentest",
    "AutoPentest",
    "pentest_flow",
    "pentest_auto",
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
  const symlinkWarningClaims = new Set<string>()
  const INDEX_VERSION = 1

  export const Info = z.object({
    type: z.literal("cyber"),
    root: z.string(),
    engagementID: z.string(),
    created: z.number(),
    scaffoldVersion: z.literal("v1"),
    rootSessionID: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const EngagementIndexEntry = z.object({
    session_id: z.string(),
    engagement_id: z.string(),
    root: z.string(),
    status: z.enum(["active", "completed", "archived"]),
    engagement_mode: z.enum(["one_off", "long_running"]),
    updated_at: z.string(),
    final_report_pdf_path: z.string().nullable(),
  })
  export type EngagementIndexEntry = z.infer<typeof EngagementIndexEntry>

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
      "- in_scope_assets: pending",
      "- out_of_scope_assets: pending",
      "- test_depth: pending",
      "",
      "## Authorization",
      "- written_authorization: pending",
      "- destructive_testing_authorized: no",
      "- approval_contact: pending",
      "",
      "## Constraints",
      "- maintenance_windows: pending",
      "- prohibited_actions: pending",
      "",
      "## Objectives",
      "1. pending",
      "",
      "## Notes",
      "- pending",
      "",
    ].join("\n")
  }

  function handoffHeader(now: string) {
    return [
      "# Handoff",
      "",
      `- Created: ${now}`,
      "",
      "## scope_status",
      "- authorization: pending",
      "- in_scope_assets: pending",
      "- restricted_actions: pending",
      "",
      "## phase_status",
      "- current_phase: pending",
      "- completed_phases: []",
      "- blocked_gates: []",
      "",
      "## completed_work",
      "- none",
      "",
      "## open_findings",
      "- none",
      "",
      "## assumptions_and_risks",
      "- none",
      "",
      "## blocked_by",
      "- none",
      "",
      "## next_actions",
      "1. pending",
      "2. pending",
      "3. pending",
      "",
      "## artifact_index",
      "- finding.md: pending",
      "- engagement.md: pending",
      "- handoff.md: pending",
      "- agents/*/results.md: pending",
      "- evidence/raw: pending",
      "- evidence/processed: pending",
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
    await fs.symlink(input.target, input.link, process.platform === "win32" ? "junction" : "dir").catch((error) => {
      const claim = `${input.link}->${input.target}`
      if (symlinkWarningClaims.has(claim)) return
      symlinkWarningClaims.add(claim)
      log.warn("failed to create cyber environment symlink", {
        link: input.link,
        target: input.target,
        error,
      })
    })
  }

  async function appendSectionIfMissing(input: { file: string; heading: string; block: string }) {
    const current = await fs.readFile(input.file, "utf8").catch(() => "")
    if (current.includes(`## ${input.heading}`)) return
    const next = `${current.trimEnd()}\n\n${input.block.trim()}\n`
    await fs.writeFile(input.file, next, "utf8")
  }

  async function normalizeLegacyPlaceholders(file: string) {
    const current = await fs.readFile(file, "utf8").catch(() => "")
    if (!current) return
    const next = current.replace(/^- TODO$/gm, "- pending")
    if (next !== current) {
      await fs.writeFile(file, next, "utf8")
    }
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

  async function updateIndex(input: {
    environment: Info
    session: Session.Info
    status?: "active" | "completed" | "archived"
    mode?: "one_off" | "long_running"
    finalReportPdfPath?: string | null
  }) {
    const file = path.join(rootBase(), "index.json")
    const data = await fs
      .readFile(file, "utf8")
      .then((x) => JSON.parse(x) as { version?: number; engagements?: EngagementIndexEntry[] })
      .catch(() => ({ version: INDEX_VERSION, engagements: [] as EngagementIndexEntry[] }))
    const entries = data.engagements ?? []
    const existingIndex = entries.findIndex((entry) => entry.session_id === input.session.id)
    const existing = existingIndex >= 0 ? entries[existingIndex] : undefined
    const entry: EngagementIndexEntry = {
      session_id: input.session.id,
      engagement_id: input.environment.engagementID,
      root: input.environment.root,
      status: input.status ?? existing?.status ?? "active",
      engagement_mode:
        input.mode ??
        existing?.engagement_mode ??
        (input.environment.engagementID.startsWith("eng_") ? "one_off" : "long_running"),
      updated_at: new Date().toISOString(),
      final_report_pdf_path: input.finalReportPdfPath ?? existing?.final_report_pdf_path ?? null,
    }
    if (existingIndex >= 0) entries[existingIndex] = entry
    else entries.push(entry)
    const body = JSON.stringify(
      {
        version: INDEX_VERSION,
        generated_at: new Date().toISOString(),
        engagements: entries.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
      },
      null,
      2,
    )
    await fs.writeFile(file, body + "\n", "utf8")
  }

  export async function ensureSharedScaffold(input: { environment: Info; session: Session.Info }) {
    const root = input.environment.root
    const now = new Date().toISOString()
    await ensureVisibleEntryPoints({ environment: input.environment })
    await fs.mkdir(path.join(root, "evidence", "raw"), { recursive: true })
    await fs.mkdir(path.join(root, "evidence", "processed"), { recursive: true })
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
    await fs.mkdir(path.join(root, "deliverables", "archive"), { recursive: true })
    await fs.mkdir(path.join(root, "tmp"), { recursive: true })
    await fs.mkdir(path.join(root, "agents"), { recursive: true })
    await fs.mkdir(path.join(root, "agents", "coordination", "inbox"), { recursive: true })
    await writeIfMissing(path.join(root, "agents", "coordination", "task-graph.json"), "{\n  \"claims\": {}\n}\n")

    await writeIfMissing(path.join(root, "finding.md"), findingHeader(input.session.id, now))
    await writeIfMissing(path.join(root, "engagement.md"), engagementHeader(input.session.id, now))
    await writeIfMissing(path.join(root, "handoff.md"), handoffHeader(now))
    const engagementPath = path.join(root, "engagement.md")
    const handoffPath = path.join(root, "handoff.md")
    await normalizeLegacyPlaceholders(engagementPath)
    await normalizeLegacyPlaceholders(handoffPath)
    await appendSectionIfMissing({
      file: engagementPath,
      heading: "Constraints",
      block: ["## Constraints", "- maintenance_windows: pending", "- prohibited_actions: pending"].join("\n"),
    })
    await appendSectionIfMissing({
      file: engagementPath,
      heading: "Objectives",
      block: ["## Objectives", "1. pending"].join("\n"),
    })
    await appendSectionIfMissing({
      file: handoffPath,
      heading: "scope_status",
      block: [
        "## scope_status",
        "- authorization: pending",
        "- in_scope_assets: pending",
        "- restricted_actions: pending",
      ].join("\n"),
    })
    await appendSectionIfMissing({
      file: handoffPath,
      heading: "phase_status",
      block: ["## phase_status", "- current_phase: pending", "- completed_phases: []", "- blocked_gates: []"].join("\n"),
    })
    await appendSectionIfMissing({
      file: handoffPath,
      heading: "completed_work",
      block: ["## completed_work", "- none"].join("\n"),
    })
    await appendSectionIfMissing({
      file: handoffPath,
      heading: "open_findings",
      block: ["## open_findings", "- none"].join("\n"),
    })
    await appendSectionIfMissing({
      file: handoffPath,
      heading: "assumptions_and_risks",
      block: ["## assumptions_and_risks", "- none"].join("\n"),
    })
    await appendSectionIfMissing({
      file: handoffPath,
      heading: "blocked_by",
      block: ["## blocked_by", "- none"].join("\n"),
    })
    await appendSectionIfMissing({
      file: handoffPath,
      heading: "next_actions",
      block: ["## next_actions", "1. pending", "2. pending", "3. pending"].join("\n"),
    })
    await appendSectionIfMissing({
      file: handoffPath,
      heading: "artifact_index",
      block: [
        "## artifact_index",
        "- finding.md: pending",
        "- engagement.md: pending",
        "- handoff.md: pending",
        "- agents/*/results.md: pending",
        "- evidence/raw: pending",
        "- evidence/processed: pending",
      ].join("\n"),
    })
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
    await updateIndex({
      environment: input.environment,
      session: input.session,
      status: "active",
      mode: "long_running",
    })
    await cleanupNoiseArtifacts({
      ...input.session,
      environment: input.environment,
    })
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
        "## executed_commands",
        "- none",
        "",
        "## generated_files",
        "- none",
        "",
        "## unverified_claims",
        "- none",
        "",
        "## failed_commands",
        "- none",
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

  export function resolveDeliverablesFinalDir(session: Session.Info) {
    if (session.environment?.type !== "cyber") return undefined
    return path.join(session.environment.root, "deliverables", "final")
  }

  export function resolveDeliverablesArchiveDir(session: Session.Info) {
    if (session.environment?.type !== "cyber") return undefined
    return path.join(session.environment.root, "deliverables", "archive")
  }

  export function resolveCoordinationDir(session: Session.Info) {
    if (session.environment?.type !== "cyber") return undefined
    return path.join(session.environment.root, "agents", "coordination")
  }

  export async function claimCoordinationScope(input: {
    session: Session.Info
    ownerSessionID: string
    scopes: string[]
    allowOverlap?: boolean
  }) {
    const dir = resolveCoordinationDir(input.session)
    if (!dir || input.scopes.length === 0) return { blocked: [], claimed: [] as string[] }
    await fs.mkdir(path.join(dir, "inbox"), { recursive: true })
    const file = path.join(dir, "task-graph.json")
    const graph: {
      claims: Record<string, { owner: string; status: string; updated_at: string }>
    } = await fs
      .readFile(file, "utf8")
      .then((x) => JSON.parse(x) as { claims?: Record<string, { owner: string; status: string; updated_at: string }> })
      .then((x) => ({ claims: x.claims ?? {} }))
      .catch(() => ({ claims: {} }))
    const claims = graph.claims
    const blocked = input.scopes.filter((scope) => {
      const active = claims[scope]
      if (!active) return false
      if (active.owner === input.ownerSessionID) return false
      return active.status === "claimed"
    })
    if (blocked.length > 0 && !input.allowOverlap) {
      return { blocked, claimed: [] as string[] }
    }
    const now = new Date().toISOString()
    for (const scope of input.scopes) {
      claims[scope] = {
        owner: input.ownerSessionID,
        status: "claimed",
        updated_at: now,
      }
    }
    await fs.writeFile(file, JSON.stringify({ claims }, null, 2) + "\n", "utf8")
    return { blocked, claimed: input.scopes }
  }

  export async function releaseCoordinationScope(input: {
    session: Session.Info
    ownerSessionID: string
    scopes: string[]
    status?: "released" | "completed" | "failed"
  }) {
    const dir = resolveCoordinationDir(input.session)
    if (!dir || input.scopes.length === 0) return
    const file = path.join(dir, "task-graph.json")
    const graph: {
      claims: Record<string, { owner: string; status: string; updated_at: string }>
    } = await fs
      .readFile(file, "utf8")
      .then((x) => JSON.parse(x) as { claims?: Record<string, { owner: string; status: string; updated_at: string }> })
      .then((x) => ({ claims: x.claims ?? {} }))
      .catch(() => ({ claims: {} }))
    const claims = graph.claims
    const nextStatus = input.status ?? "released"
    const now = new Date().toISOString()
    for (const scope of input.scopes) {
      const active = claims[scope]
      if (!active || active.owner !== input.ownerSessionID) continue
      claims[scope] = {
        ...active,
        status: nextStatus,
        updated_at: now,
      }
    }
    await fs.writeFile(file, JSON.stringify({ claims }, null, 2) + "\n", "utf8")
  }

  export async function appendCoordinationInbox(input: {
    session: Session.Info
    ownerSessionID: string
    payload: Record<string, unknown>
  }) {
    const dir = resolveCoordinationDir(input.session)
    if (!dir) return
    const inboxFile = path.join(dir, "inbox", `${input.ownerSessionID}.jsonl`)
    const row = JSON.stringify({
      ...input.payload,
      owner_session_id: input.ownerSessionID,
      timestamp: new Date().toISOString(),
    })
    await fs.appendFile(inboxFile, row + "\n", "utf8")
  }

  export async function updateEngagementIndex(input: {
    session: Session.Info
    status?: "active" | "completed" | "archived"
    mode?: "one_off" | "long_running"
    finalReportPdfPath?: string | null
  }) {
    if (input.session.environment?.type !== "cyber") return
    await updateIndex({
      environment: input.session.environment,
      session: input.session,
      status: input.status,
      mode: input.mode,
      finalReportPdfPath: input.finalReportPdfPath,
    })
  }

  export async function cleanupNoiseArtifacts(session: Session.Info) {
    if (session.environment?.type !== "cyber") return
    const root = session.environment.root
    const targets = [path.join(root, "tmp"), path.join(root, "agents")]
    for (const target of targets) {
      const stat = await fs.stat(target).catch(() => undefined)
      if (!stat?.isDirectory()) continue
      const files = await fs.readdir(target, { withFileTypes: true }).catch(() => [])
      for (const file of files) {
        if (file.name === "coordination") continue
        const full = path.join(target, file.name)
        const item = await fs.stat(full).catch(() => undefined)
        if (!item) continue
        if (item.isFile() && item.size === 0) {
          await fs.rm(full, { force: true })
        }
      }
    }
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
