import fs from "fs/promises"
import path from "path"
import type { BackgroundJob } from "@/background/job"
import { operationPath, slug } from "./artifact"
import { defaultToolManifestPath, readToolManifest, type CommandProfile } from "./tool-manifest"
import type { EvidenceLead } from "./evidence-normalizer"

export type WorkUnitStatus = "queued" | "running" | "complete" | "failed" | "skipped"

export type WorkUnit = {
  id: string
  operationID: string
  laneID: string
  profileID: string
  leadID?: string
  status: WorkUnitStatus
  variables: Record<string, string>
  outputPrefix: string
  rationale: string
  safety: "non_destructive"
  attempts: number
  jobID?: string
  createdAt: string
  updatedAt: string
}

export type WorkQueueRecord = {
  operationID: string
  generatedAt: string
  units: WorkUnit[]
}

export type WorkQueueInput = {
  operationID: string
  manifestPath?: string
  maxUnits?: number
  includePassiveBaseline?: boolean
  wordlist?: string
}

export type WorkQueueResult = {
  operationID: string
  queuePath: string
  inputFiles: string[]
  generated: number
  skipped: string[]
  units: WorkUnit[]
}

export type WorkQueueNextInput = {
  operationID: string
  laneID?: string
  limit?: number
  claim?: boolean
}

export type WorkQueueNextResult = {
  operationID: string
  queuePath: string
  units: Array<
    WorkUnit & {
      commandSupervise: {
        operationID: string
        laneID: string
        workUnitID: string
        profileID: string
        variables: Record<string, string>
        outputPrefix: string
        dryRun: boolean
      }
    }
  >
}

type LeadsRecord = {
  leads?: EvidenceLead[]
}

export type WorkQueueJobSyncResult = {
  operationID: string
  queuePath: string
  syncedUnits: string[]
  completedUnits: string[]
  failedUnits: string[]
}

export type WorkQueueLeaseResult = {
  operationID: string
  queuePath: string
  requeuedUnits: string[]
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

function unitID(input: { profileID: string; variables: Record<string, string> }) {
  return slug(`${input.profileID}-${JSON.stringify(Object.entries(input.variables).toSorted())}`, "work-unit")
}

function assertNonDestructive(profile: CommandProfile) {
  if (profile.safety !== "non_destructive") {
    throw new Error(`work queue only emits non_destructive command profiles; ${profile.id} is ${profile.safety}`)
  }
}

function profileMap(profiles: CommandProfile[]) {
  return new Map(profiles.map((profile) => [profile.id, profile]))
}

function dedupeValues(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))].sort()
}

function httpSurface(lead: EvidenceLead) {
  if (lead.url?.startsWith("http://") || lead.url?.startsWith("https://")) return lead.url
  if (lead.kind === "service" && lead.host && (lead.port === 80 || lead.port === 8080)) return `http://${lead.host}:${lead.port}`
  if (lead.kind === "service" && lead.host && lead.port === 443) return `https://${lead.host}`
  return undefined
}

function addUnit(input: {
  units: WorkUnit[]
  existing: Map<string, WorkUnit>
  operationID: string
  laneID: string
  profile: CommandProfile
  variables: Record<string, string>
  outputPrefix: string
  leadID?: string
  rationale: string
  now: string
}) {
  assertNonDestructive(input.profile)
  const id = unitID({ profileID: input.profile.id, variables: input.variables })
  const current = input.existing.get(id)
  if (current) return
  const unit: WorkUnit = {
    id,
    operationID: input.operationID,
    laneID: input.laneID,
    profileID: input.profile.id,
    leadID: input.leadID,
    status: "queued",
    variables: input.variables,
    outputPrefix: input.outputPrefix,
    rationale: input.rationale,
    safety: "non_destructive",
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
  }
  input.units.push(unit)
  input.existing.set(id, unit)
}

export async function buildWorkQueue(worktree: string, input: WorkQueueInput): Promise<WorkQueueResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const manifest = await readToolManifest(input.manifestPath ?? defaultToolManifestPath(worktree))
  const profiles = profileMap(manifest.commandProfiles)
  const queuePath = path.join(root, "work-queue.json")
  const current = await readJson<WorkQueueRecord>(queuePath)
  const existing = new Map((current?.units ?? []).map((unit) => [unit.id, unit]))
  const leads = (await readJson<LeadsRecord>(path.join(root, "leads.json")))?.leads ?? []
  const now = new Date().toISOString()
  const generated: WorkUnit[] = []
  const skipped: string[] = []
  const inputFiles: string[] = []
  const maxUnits = input.maxUnits ?? 100

  const hosts = dedupeValues(leads.map((lead) => lead.host ?? lead.asset).filter((value) => value && !value.startsWith("http")))
  const urls = dedupeValues(leads.map(httpSurface))

  const serviceInventory = profiles.get("service-inventory")
  if (serviceInventory) {
    for (const target of hosts.slice(0, maxUnits)) {
      addUnit({
        units: generated,
        existing,
        operationID,
        laneID: "recon",
        profile: serviceInventory,
        variables: { target },
        outputPrefix: `evidence/raw/service-inventory-${slug(target, "target")}`,
        rationale: `Service inventory for discovered host ${target}`,
        now,
      })
    }
  } else if (hosts.length) {
    skipped.push("service-inventory profile missing")
  }

  const httpDiscovery = profiles.get("http-discovery")
  if (httpDiscovery && hosts.length) {
    const inputFile = path.join(root, "queues", "http-discovery-hosts.txt")
    await fs.mkdir(path.dirname(inputFile), { recursive: true })
    await fs.writeFile(inputFile, hosts.join("\n") + "\n")
    inputFiles.push(inputFile)
    addUnit({
      units: generated,
      existing,
      operationID,
      laneID: "web_inventory",
      profile: httpDiscovery,
      variables: { inputFile: path.relative(root, inputFile) },
      outputPrefix: "evidence/raw/http-discovery",
      rationale: `HTTP discovery for ${hosts.length} queued hosts`,
      now,
    })
  } else if (hosts.length) {
    skipped.push("http-discovery profile missing")
  }

  const contentDiscovery = profiles.get("content-discovery")
  if (contentDiscovery) {
    for (const url of urls.slice(0, maxUnits)) {
      addUnit({
        units: generated,
        existing,
        operationID,
        laneID: "web_inventory",
        profile: contentDiscovery,
        variables: { url, wordlist: input.wordlist ?? "wordlists/common.txt" },
        outputPrefix: `evidence/raw/content-discovery-${slug(url, "url")}`,
        leadID: leads.find((lead) => httpSurface(lead) === url)?.id,
        rationale: `Conservative content discovery for ${url}`,
        now,
      })
    }
  } else if (urls.length) {
    skipped.push("content-discovery profile missing")
  }

  const passiveBaseline = profiles.get("passive-web-baseline")
  if (input.includePassiveBaseline && passiveBaseline) {
    for (const url of urls.slice(0, Math.min(maxUnits, 10))) {
      addUnit({
        units: generated,
        existing,
        operationID,
        laneID: "web_inventory",
        profile: passiveBaseline,
        variables: { url },
        outputPrefix: `evidence/raw/zap-${slug(url, "url")}`,
        leadID: leads.find((lead) => httpSurface(lead) === url)?.id,
        rationale: `Passive ZAP baseline for ${url}`,
        now,
      })
    }
  }

  const units = [...(current?.units ?? []), ...generated].sort((a, b) => a.id.localeCompare(b.id))
  await writeJson(queuePath, { operationID, generatedAt: now, units } satisfies WorkQueueRecord)
  return { operationID, queuePath, inputFiles, generated: generated.length, skipped, units }
}

export async function nextWorkUnits(worktree: string, input: WorkQueueNextInput): Promise<WorkQueueNextResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const queuePath = path.join(root, "work-queue.json")
  const queue = await readJson<WorkQueueRecord>(queuePath)
  if (!queue) throw new Error("work queue is missing; run operation_queue first")
  const limit = input.limit ?? 5
  const now = new Date().toISOString()
  const selected = queue.units
    .filter((unit) => unit.status === "queued")
    .filter((unit) => !input.laneID || unit.laneID === input.laneID)
    .slice(0, limit)
  if (input.claim) {
    const selectedIDs = new Set(selected.map((unit) => unit.id))
    queue.units = queue.units.map((unit) =>
      selectedIDs.has(unit.id)
        ? {
            ...unit,
            status: "running",
            attempts: unit.attempts + 1,
            updatedAt: now,
          }
        : unit,
    )
    await writeJson(queuePath, { ...queue, generatedAt: now })
  }
  return {
    operationID,
    queuePath,
    units: selected.map((unit) => ({
      ...(input.claim ? { ...unit, status: "running" as const, attempts: unit.attempts + 1, updatedAt: now } : unit),
      commandSupervise: {
        operationID,
        laneID: unit.laneID,
        workUnitID: unit.id,
        profileID: unit.profileID,
        variables: unit.variables,
        outputPrefix: unit.outputPrefix,
        dryRun: true,
      },
    })),
  }
}

export async function syncWorkQueueJobs(
  worktree: string,
  input: { operationID: string; backgroundJobs?: BackgroundJob.Info[] },
): Promise<WorkQueueJobSyncResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const queuePath = path.join(root, "work-queue.json")
  const queue = await readJson<WorkQueueRecord>(queuePath)
  const syncedUnits: string[] = []
  const completedUnits: string[] = []
  const failedUnits: string[] = []
  if (!queue || !input.backgroundJobs?.length) {
    return { operationID, queuePath, syncedUnits, completedUnits, failedUnits }
  }

  const now = new Date().toISOString()
  const unitsByID = new Map(queue.units.map((unit) => [unit.id, unit]))
  for (const job of input.backgroundJobs) {
    const metadataOperation = job.metadata?.operationID
    const workUnitID = job.metadata?.workUnitID
    if (metadataOperation !== operationID || typeof workUnitID !== "string") continue
    const unit = unitsByID.get(workUnitID)
    if (!unit) continue
    unit.jobID = job.id
    unit.updatedAt = now
    syncedUnits.push(unit.id)
    if (job.status === "running") {
      unit.status = "running"
      continue
    }
    if (job.status === "completed") {
      unit.status = "complete"
      completedUnits.push(unit.id)
      continue
    }
    if (job.status === "error" || job.status === "cancelled" || job.status === "stale") {
      unit.status = "failed"
      failedUnits.push(unit.id)
    }
  }

  if (syncedUnits.length) await writeJson(queuePath, { ...queue, generatedAt: now })
  return { operationID, queuePath, syncedUnits, completedUnits, failedUnits }
}

export async function bindWorkUnitJob(
  worktree: string,
  input: { operationID: string; workUnitID: string; jobID: string },
): Promise<boolean> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const queuePath = path.join(root, "work-queue.json")
  const queue = await readJson<WorkQueueRecord>(queuePath)
  if (!queue) return false
  const unit = queue.units.find((item) => item.id === input.workUnitID)
  if (!unit) return false
  unit.jobID = input.jobID
  unit.status = "running"
  unit.updatedAt = new Date().toISOString()
  await writeJson(queuePath, { ...queue, generatedAt: unit.updatedAt })
  return true
}

export async function requeueStaleWorkUnits(
  worktree: string,
  input: { operationID: string; leaseSeconds?: number; now?: Date },
): Promise<WorkQueueLeaseResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const queuePath = path.join(root, "work-queue.json")
  const queue = await readJson<WorkQueueRecord>(queuePath)
  const requeuedUnits: string[] = []
  if (!queue) return { operationID, queuePath, requeuedUnits }
  const now = input.now ?? new Date()
  const leaseMs = (input.leaseSeconds ?? 600) * 1000
  for (const unit of queue.units) {
    if (unit.status !== "running" || unit.jobID) continue
    const updated = Date.parse(unit.updatedAt)
    if (Number.isNaN(updated) || now.getTime() - updated <= leaseMs) continue
    unit.status = "queued"
    unit.updatedAt = now.toISOString()
    requeuedUnits.push(unit.id)
  }
  if (requeuedUnits.length) await writeJson(queuePath, { ...queue, generatedAt: now.toISOString() })
  return { operationID, queuePath, requeuedUnits }
}

export function formatWorkQueue(result: WorkQueueResult) {
  return [
    `# Work Queue: ${result.operationID}`,
    "",
    `- generated: ${result.generated}`,
    `- total_units: ${result.units.length}`,
    `- queue: ${result.queuePath}`,
    "",
    "## Input Files",
    "",
    ...(result.inputFiles.length ? result.inputFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    "## Queued Units",
    "",
    ...result.units
      .filter((unit) => unit.status === "queued")
      .slice(0, 30)
      .map((unit) => `- ${unit.id}: ${unit.profileID} ${JSON.stringify(unit.variables)}`),
    ...(result.units.some((unit) => unit.status === "queued") ? [] : ["- none"]),
    "",
    "## Skipped",
    "",
    ...(result.skipped.length ? result.skipped.map((item) => `- ${item}`) : ["- none"]),
    "",
    "<work_queue_json>",
    JSON.stringify(result, null, 2),
    "</work_queue_json>",
  ].join("\n")
}

export function formatWorkQueueNext(result: WorkQueueNextResult) {
  return [
    `# Next Work Units: ${result.operationID}`,
    "",
    `- selected: ${result.units.length}`,
    `- queue: ${result.queuePath}`,
    "",
    "## Command Supervise Params",
    "",
    ...(result.units.length
      ? result.units.map((unit) => `- ${unit.id}: ${JSON.stringify(unit.commandSupervise)}`)
      : ["- none"]),
    "",
    "<work_queue_next_json>",
    JSON.stringify(result, null, 2),
    "</work_queue_next_json>",
  ].join("\n")
}
