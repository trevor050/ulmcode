#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../..")
const profileRoot = path.join(repoRoot, "tools", "ulmcode-profile")
const skillsRoot = path.join(profileRoot, "skills")
const commandsRoot = path.join(profileRoot, "commands")
const durableTools = [
  "operation_audit",
  "operation_resume",
  "operation_status",
  "operation_stage_gate",
  "operation_plan",
  "operation_checkpoint",
  "evidence_record",
  "finding_record",
  "report_outline",
  "report_lint",
  "report_render",
  "runtime_summary",
  "task",
  "task_list",
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

for (const tool of [
  "operation_audit",
  "operation_resume",
  "operation_stage_gate",
  "operation_plan",
  "evidence_record",
  "finding_record",
  "report_lint",
]) {
  if (!toolCoverage.has(tool)) throw new Error(`skill pack never references ${tool}`)
}

console.log("ulm_profile_skills: ok")
console.log(`skills: ${skills.length}`)
console.log(`commands: ${commands.length}`)
