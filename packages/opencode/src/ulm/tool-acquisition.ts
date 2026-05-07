import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"
import { defaultToolManifestPath, readToolManifest, type ToolManifestTool } from "./tool-manifest"

export type ToolAcquireInput = {
  worktree: string
  operationID: string
  toolID: string
  install?: boolean
  platform?: string
  manifestPath?: string
}

export type ToolAcquireResult = {
  operationID: string
  toolID: string
  available: boolean
  installed: boolean
  blocker?: string
  validationCommand: string
  installCommand?: string
  fallbacks: string[]
  recordPath: string
}

export type ToolManifestPreflightInput = Omit<ToolAcquireInput, "toolID"> & {
  toolIDs?: string[]
}

export type ToolManifestPreflightResult = {
  operationID: string
  total: number
  available: number
  blocked: number
  installed: number
  installAttempted: boolean
  tools: ToolAcquireResult[]
  summaryPath: string
  markdownPath: string
}

async function run(command: string, cwd: string) {
  const proc = Bun.spawn(["bash", "-lc", command], { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

function installCommand(tool: ToolManifestTool, platform: string | undefined) {
  return (
    tool.install.find((item) => platform && item.platform === platform)?.command ??
    tool.install.find((item) => item.platform === process.platform)?.command ??
    tool.install[0]?.command
  )
}

export async function acquireTool(input: ToolAcquireInput): Promise<ToolAcquireResult> {
  const manifest = await readToolManifest(input.manifestPath ?? defaultToolManifestPath(input.worktree))
  const tool = manifest.tools.find((item) => item.id === input.toolID)
  if (!tool) throw new Error(`unknown tool: ${input.toolID}`)
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(input.worktree, operationID)
  const recordPath = path.join(root, "tools", `${slug(input.toolID, "tool")}.json`)
  const validation = await run(tool.validate, input.worktree)
  let installed = false
  let available = validation.exitCode === 0
  let blocker: string | undefined
  const command = installCommand(tool, input.platform)

  if (!available && input.install && command) {
    const install = await run(command, input.worktree)
    installed = install.exitCode === 0
    if (installed) {
      const recheck = await run(tool.validate, input.worktree)
      available = recheck.exitCode === 0
      if (!available) blocker = `${tool.id} installed but validation still failed: ${recheck.stderr || recheck.stdout}`
    } else {
      blocker = `${tool.id} install failed: ${install.stderr || install.stdout}`
    }
  } else if (!available) {
    blocker = `${tool.id} validation failed; install required before supervised command execution`
  }

  const result: ToolAcquireResult = {
    operationID,
    toolID: tool.id,
    available,
    installed,
    blocker,
    validationCommand: tool.validate,
    installCommand: command,
    fallbacks: tool.fallbacks,
    recordPath,
  }
  await fs.mkdir(path.dirname(recordPath), { recursive: true })
  await fs.writeFile(recordPath, JSON.stringify({ ...result, checkedAt: new Date().toISOString() }, null, 2) + "\n")
  return result
}

function preflightMarkdown(result: ToolManifestPreflightResult) {
  const blocked = result.tools.filter((tool) => !tool.available)
  return [
    `# Tool Preflight: ${result.operationID}`,
    "",
    `- total: ${result.total}`,
    `- available: ${result.available}`,
    `- blocked: ${result.blocked}`,
    `- installed: ${result.installed}`,
    `- install_attempted: ${result.installAttempted}`,
    "",
    "| Tool | Available | Installed | Install Command | Fallbacks | Blocker |",
    "| --- | --- | --- | --- | --- | --- |",
    ...result.tools.map(
      (tool) =>
        `| ${tool.toolID} | ${tool.available ? "yes" : "no"} | ${tool.installed ? "yes" : "no"} | ${tool.installCommand ?? "none"} | ${tool.fallbacks.join(", ") || "none"} | ${tool.blocker ?? ""} |`,
    ),
    "",
    "## Blocked Install Plan",
    "",
    ...(blocked.length
      ? blocked.flatMap((tool) => [
          `### ${tool.toolID}`,
          "",
          `- validation: \`${tool.validationCommand}\``,
          `- install: ${tool.installCommand ? `\`${tool.installCommand}\`` : "none recorded"}`,
          `- fallbacks: ${tool.fallbacks.join(", ") || "none"}`,
          `- blocker: ${tool.blocker ?? "unknown"}`,
          "",
        ])
      : ["- none", ""]),
    "",
  ].join("\n")
}

export async function acquireManifestTools(input: ToolManifestPreflightInput): Promise<ToolManifestPreflightResult> {
  const manifestPath = input.manifestPath ?? defaultToolManifestPath(input.worktree)
  const manifest = await readToolManifest(manifestPath)
  const selected = new Set(input.toolIDs ?? manifest.tools.map((tool) => tool.id))
  const tools: ToolAcquireResult[] = []
  for (const tool of manifest.tools) {
    if (!selected.has(tool.id)) continue
    tools.push(
      await acquireTool({
        ...input,
        manifestPath,
        toolID: tool.id,
      }),
    )
  }
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(input.worktree, operationID)
  const summaryPath = path.join(root, "tools", "tool-preflight.json")
  const markdownPath = path.join(root, "tools", "tool-preflight.md")
  const result: ToolManifestPreflightResult = {
    operationID,
    total: tools.length,
    available: tools.filter((tool) => tool.available).length,
    blocked: tools.filter((tool) => !tool.available).length,
    installed: tools.filter((tool) => tool.installed).length,
    installAttempted: input.install === true,
    tools,
    summaryPath,
    markdownPath,
  }
  await fs.mkdir(path.dirname(summaryPath), { recursive: true })
  await fs.writeFile(summaryPath, JSON.stringify({ ...result, checkedAt: new Date().toISOString() }, null, 2) + "\n")
  await fs.writeFile(markdownPath, preflightMarkdown(result))
  return result
}
