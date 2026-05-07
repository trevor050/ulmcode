#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../..")
const profileRoot = path.join(repoRoot, "tools", "ulmcode-profile")
const skillsRoot = path.join(profileRoot, "skills")
const commandsRoot = path.join(profileRoot, "commands")
const profileConfig = path.join(profileRoot, "opencode.json")
const durableTools = [
  "operation_audit",
  "operation_recover",
  "operation_resume",
  "operation_run",
  "runtime_scheduler",
  "runtime_daemon",
  "operation_status",
  "operation_stage_gate",
  "operation_plan",
  "operation_schedule",
  "operation_queue",
  "operation_queue_next",
  "operation_governor",
  "operation_next",
  "operation_checkpoint",
  "tool_acquire",
  "command_supervise",
  "evidence_normalize",
  "evidence_record",
  "finding_record",
  "report_outline",
  "report_lint",
  "report_render",
  "runtime_summary",
  "task",
  "task_list",
  "task_restart",
  "task_status",
]

async function walk(dir: string, predicate: (file: string) => boolean): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(full, predicate)
      return predicate(full) ? [full] : []
    }),
  )
  return files.flat().sort()
}

function parseFrontmatter(file: string, content: string) {
  const lines = content.split(/\r?\n/)
  if (lines[0] !== "---") throw new Error(`${file}: missing opening frontmatter fence`)
  const end = lines.indexOf("---", 1)
  if (end === -1) throw new Error(`${file}: missing closing frontmatter fence`)
  const values = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    const match = /^([a-zA-Z0-9_-]+):\s*(.+)$/.exec(line)
    if (!match) continue
    values.set(match[1], match[2].replace(/^["']|["']$/g, ""))
  }
  return {
    values,
    body: lines.slice(end + 1).join("\n"),
  }
}

function referencedTools(content: string) {
  return durableTools.filter((tool) => new RegExp(`\\b${tool}\\b`).test(content))
}

function assertNoPlaceholders(file: string, content: string) {
  if (/\b(TBD|TODO|FIXME)\b/i.test(content)) throw new Error(`${file}: contains placeholder text`)
}

async function validateSkill(file: string) {
  const content = await fs.readFile(file, "utf8")
  assertNoPlaceholders(file, content)
  const { values, body } = parseFrontmatter(file, content)
  const name = values.get("name")
  const description = values.get("description")
  if (!name) throw new Error(`${file}: missing name`)
  if (name !== path.basename(path.dirname(file))) throw new Error(`${file}: name must match directory`)
  if (!description) throw new Error(`${file}: missing description`)
  if (!description.startsWith("Use ")) throw new Error(`${file}: description should start with "Use"`)
  if (!/^#\s+\S+/m.test(body)) throw new Error(`${file}: missing H1`)
  const tools = referencedTools(content)
  if (!tools.length) throw new Error(`${file}: must reference at least one durable ULM tool`)
  return { file, name, tools }
}

async function validateCommand(file: string) {
  const content = await fs.readFile(file, "utf8")
  assertNoPlaceholders(file, content)
  const { values } = parseFrontmatter(file, content)
  if (!values.get("description")) throw new Error(`${file}: missing description`)
  if (path.basename(file) === "ulm-resume.md" && !content.includes("operation_resume")) {
    throw new Error(`${file}: resume command must call operation_resume`)
  }
  if (path.basename(file) === "ulm-resume.md" && !content.includes("recoverStaleTasks: true")) {
    throw new Error(`${file}: resume command must recover stale tasks during unattended resumes`)
  }
  if (path.basename(file) === "ulm-final-handoff.md" && !content.includes("finalHandoff: true")) {
    throw new Error(`${file}: final handoff command must require finalHandoff lint`)
  }
  if (path.basename(file) === "ulm-final-handoff.md" && !content.includes("operation_audit")) {
    throw new Error(`${file}: final handoff command must call operation_audit`)
  }
  return { file }
}

const skillFiles = await walk(skillsRoot, (file) => path.basename(file) === "SKILL.md")
const commandFiles = await walk(commandsRoot, (file) => file.endsWith(".md"))
const skills = await Promise.all(skillFiles.map(validateSkill))
const commands = await Promise.all(commandFiles.map(validateCommand))
const toolCoverage = new Set(skills.flatMap((skill) => skill.tools))
type AgentConfig = {
  model?: string
  options?: {
    reasoningEffort?: string
  }
}

type ProfileConfig = {
  model?: string
  small_model?: string
  default_agent?: string
  instructions?: string[]
  plugin?: string[]
  agent?: Record<string, AgentConfig>
}

type OmoRoute = {
  model?: string
  variant?: string
  reasoningEffort?: string
}

type OmoConfig = {
  agents?: Record<string, OmoRoute>
  categories?: Record<string, OmoRoute>
}

const opencodeConfig = JSON.parse(await fs.readFile(profileConfig, "utf8")) as ProfileConfig

function assertRoute(file: string, id: string, route: OmoRoute | undefined, expected: OmoRoute) {
  if (!route) throw new Error(`${file}: missing route ${id}`)
  for (const [key, value] of Object.entries(expected)) {
    if (route[key as keyof OmoRoute] !== value) {
      throw new Error(`${file}: route ${id} expected ${key}=${value}, got ${route[key as keyof OmoRoute] ?? "undefined"}`)
    }
  }
}

function validateRouting() {
  if (opencodeConfig.model !== "openai/gpt-5.5-fast") throw new Error("profile model must default to GPT-5.5 Fast")
  if (opencodeConfig.small_model !== "openai/gpt-5.4-mini-fast") throw new Error("profile small_model must use GPT-5.4 Mini Fast")
  if (opencodeConfig.default_agent !== "pentest") throw new Error("profile default agent must be pentest")

  assertRoute("opencode.json", "pentest", opencodeConfig.agent?.pentest, {
    model: "openai/gpt-5.5-fast",
  })
  assertRoute("opencode.json", "recon", opencodeConfig.agent?.recon, {
    model: "openai/gpt-5.4-mini-fast",
  })
  assertRoute("opencode.json", "evidence", opencodeConfig.agent?.evidence, {
    model: "openai/gpt-5.4-mini-fast",
  })
  assertRoute("opencode.json", "validator", opencodeConfig.agent?.validator, {
    model: "openai/gpt-5.5-fast",
  })
  if (opencodeConfig.agent?.validator?.options?.reasoningEffort !== "xhigh") {
    throw new Error("opencode.json: validator must use xhigh reasoning")
  }
  if (opencodeConfig.agent?.["report-reviewer"]?.options?.reasoningEffort !== "xhigh") {
    throw new Error("opencode.json: report-reviewer must use xhigh reasoning")
  }
  if (opencodeConfig.plugin?.some((plugin) => plugin === "oh-my-openagent" || plugin === "oh-my-opencode")) {
    throw new Error("opencode.json: ULM profile must not load Oh My OpenAgent")
  }
}

if (!opencodeConfig.instructions?.includes("__ULMCODE_PROFILE_DIR__/plugins/shell-strategy/shell_strategy.md")) {
  throw new Error("profile config must load the bundled shell non-interactive strategy")
}

const shellStrategy = await fs.readFile(path.join(profileRoot, "plugins", "shell-strategy", "shell_strategy.md"), "utf8")
for (const needle of ["Shell Non-Interactive Strategy", "GIT_TERMINAL_PROMPT", "Process Continuity", "Long Command Handoff"]) {
  if (!shellStrategy.includes(needle)) throw new Error(`shell strategy is missing ${needle}`)
}

const operationPlanPrompt = await fs.readFile(path.join(repoRoot, "packages", "opencode", "src", "tool", "operation_plan.txt"), "utf8")
for (const needle of ["Plannotator-style critique lane", "critic only", "does not replace native Build/Plan", "operation audit"]) {
  if (!operationPlanPrompt.includes(needle)) throw new Error(`operation_plan prompt is missing Plannotator guardrail: ${needle}`)
}

const profileReadme = await fs.readFile(path.join(profileRoot, "README.md"), "utf8")
for (const needle of ["General personal OpenCode agents", "Sisyphus", "OpenCode-Builder"]) {
  if (!profileReadme.includes(needle)) throw new Error(`profile README is missing isolation note: ${needle}`)
}

for (const command of [
  "ulm-final-handoff.md",
  "ulm-resume.md",
  "ulm-test-plan.md",
]) {
  if (!commandFiles.some((file) => path.basename(file) === command)) {
    throw new Error(`profile commands missing ${command}`)
  }
}

for (const tool of [
  "operation_audit",
  "operation_resume",
  "operation_stage_gate",
  "operation_plan",
  "operation_schedule",
  "operation_queue",
  "operation_queue_next",
  "operation_governor",
  "operation_next",
  "operation_run",
  "runtime_scheduler",
  "runtime_daemon",
  "tool_acquire",
  "command_supervise",
  "evidence_normalize",
  "evidence_record",
  "finding_record",
  "report_outline",
  "report_lint",
  "report_render",
  "runtime_summary",
  "task_status",
]) {
  if (!toolCoverage.has(tool)) throw new Error(`skill pack never references ${tool}`)
}

validateRouting()

console.log("ulm_profile_skills: ok")
console.log("routing: ok")
console.log(`skills: ${skills.length}`)
console.log(`commands: ${commands.length}`)
