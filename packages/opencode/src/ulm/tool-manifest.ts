import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"

export type ToolSafety = "non_destructive" | "interactive_destructive"

export type ToolManifest = {
  version: number
  lastReviewed: string
  policy: {
    defaultSafetyMode: ToolSafety
    destructiveSafetyMode: ToolSafety
    installFailureBehavior: string
    notes: string[]
  }
  tools: ToolManifestTool[]
  commandProfiles: CommandProfile[]
}

export type ToolManifestTool = {
  id: string
  purpose: string
  safety: ToolSafety
  install: Array<{ platform: string; command: string }>
  validate: string
  safeExamples: string[]
  outputParsers: string[]
  fallbacks: string[]
}

export type CommandProfile = {
  id: string
  tool: string
  safety: ToolSafety
  template: string
  heartbeatSeconds: number
  idleTimeoutSeconds: number
  hardTimeoutSeconds: number
  restartable: boolean
  artifacts: string[]
}

export type CommandPlanInput = {
  worktree: string
  operationID: string
  profileID: string
  variables?: Record<string, string | undefined>
  outputPrefix?: string
  manifestPath?: string
}

export type CommandPlan = {
  operationID: string
  profile: CommandProfile
  tool?: ToolManifestTool
  command: string
  variables: Record<string, string | undefined>
  outputPrefix: string
  manifestPath: string
  supervision: {
    heartbeatSeconds: number
    idleTimeoutSeconds: number
    hardTimeoutSeconds: number
    restartable: boolean
  }
  artifacts: string[]
  operationRoot: string
  planPath: string
  stdoutPath: string
  stderrPath: string
  heartbeatPath: string
}

export function defaultToolManifestPath(worktree: string) {
  return path.join(worktree, "tools", "ulmcode-profile", "tool-manifest.json")
}

export async function readToolManifest(file: string): Promise<ToolManifest> {
  return JSON.parse(await fs.readFile(file, "utf8")) as ToolManifest
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function renderTemplate(template: string, variables: Record<string, string | undefined>) {
  return template.replaceAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, key: string) => {
    const value = variables[key]
    if (!value) throw new Error(`command profile requires variable ${key}`)
    return shellQuote(value)
  })
}

function renderedArtifacts(profile: CommandProfile, outputPrefix: string) {
  const artifacts = new Set(profile.artifacts)
  if (profile.template.includes("{outputPrefix}.jsonl")) artifacts.add(`${outputPrefix}.jsonl`)
  if (profile.template.includes("{outputPrefix}.json")) artifacts.add(`${outputPrefix}.json`)
  if (profile.template.includes("-oA {outputPrefix}") || profile.template.includes("-oA{outputPrefix}")) {
    artifacts.add(`${outputPrefix}.nmap`)
    artifacts.add(`${outputPrefix}.xml`)
    artifacts.add(`${outputPrefix}.gnmap`)
  }
  return [...artifacts]
}

export async function buildCommandPlan(input: CommandPlanInput): Promise<CommandPlan> {
  const manifestPath = input.manifestPath ?? defaultToolManifestPath(input.worktree)
  const manifest = await readToolManifest(manifestPath)
  const profile = manifest.commandProfiles.find((item) => item.id === input.profileID)
  if (!profile) throw new Error(`unknown command profile: ${input.profileID}`)
  if (profile.safety !== "non_destructive") {
    throw new Error(`command profile ${profile.id} is ${profile.safety}; unattended command_supervise only allows non_destructive`)
  }
  const tool = manifest.tools.find((item) => item.id === profile.tool)
  if (!tool) throw new Error(`command profile ${profile.id} references missing tool ${profile.tool}`)

  const operationID = slug(input.operationID, "operation")
  const root = operationPath(input.worktree, operationID)
  const commandRoot = path.join(root, "commands", slug(profile.id, "command-profile"))
  const outputPrefix =
    input.outputPrefix ?? path.join("evidence", "raw", `${slug(profile.id, "command")}-${Date.now()}`)
  const variables = { ...input.variables, outputPrefix }
  const command = renderTemplate(profile.template, variables)
  const artifacts = renderedArtifacts(profile, outputPrefix)
  const stdoutPath = path.join(commandRoot, "stdout.log")
  const stderrPath = path.join(commandRoot, "stderr.log")
  const heartbeatPath = path.join(commandRoot, "heartbeat.json")
  const planPath = path.join(commandRoot, "command-plan.json")

  return {
    operationID,
    profile,
    tool,
    command,
    variables,
    outputPrefix,
    manifestPath,
    supervision: {
      heartbeatSeconds: profile.heartbeatSeconds,
      idleTimeoutSeconds: profile.idleTimeoutSeconds,
      hardTimeoutSeconds: profile.hardTimeoutSeconds,
      restartable: profile.restartable,
    },
    artifacts,
    operationRoot: root,
    planPath,
    stdoutPath,
    stderrPath,
    heartbeatPath,
  }
}

export async function writeCommandPlan(plan: CommandPlan) {
  await fs.mkdir(path.dirname(plan.planPath), { recursive: true })
  await fs.writeFile(
    plan.planPath,
    JSON.stringify(
      {
        operationID: plan.operationID,
        profileID: plan.profile.id,
        tool: plan.profile.tool,
        safety: plan.profile.safety,
        command: plan.command,
        variables: plan.variables,
        outputPrefix: plan.outputPrefix,
        manifestPath: plan.manifestPath,
        supervision: plan.supervision,
        artifacts: plan.artifacts,
        operationRoot: plan.operationRoot,
        stdoutPath: plan.stdoutPath,
        stderrPath: plan.stderrPath,
        heartbeatPath: plan.heartbeatPath,
        plannedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  )
}
