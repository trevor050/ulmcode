import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { PermissionNext } from "../permission/next"
import { Ripgrep } from "../file/ripgrep"
import { iife } from "@/util/iife"
import { ConfigMarkdown } from "../config/markdown"
import { Filesystem } from "@/util/filesystem"

export const SkillTool = Tool.define("skill", async (ctx) => {
  const skills = await Skill.all()

  // Filter skills by agent permissions if agent provided
  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : skills

  const description =
    accessibleSkills.length === 0
      ? "Load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
      : [
          "Load a specialized skill that provides domain-specific instructions and workflows.",
          "",
          "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
          "",
          "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
          "",
          'Tool output includes a `<skill_content name="...">` block with the loaded content.',
          "",
          "The following skills provide specialized sets of instructions for particular tasks",
          "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
          "",
          "<available_skills>",
          ...accessibleSkills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `    <location>${pathToFileURL(skill.location).href}</location>`,
            `  </skill>`,
          ]),
          "</available_skills>",
        ].join("\n")

  const examples = accessibleSkills
    .map((skill) => `'${skill.name}'`)
    .slice(0, 3)
    .join(", ")
  const hint = examples.length > 0 ? ` (e.g., ${examples}, ...)` : ""

  const parameters = z.object({
    name: z.string().describe(`The name of the skill from available_skills${hint}`),
  })

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const skill = await Skill.get(params.name)

      if (!skill) {
        const available = await Skill.all().then((x) => x.map((s) => s.name).sort().join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })

      const dir = path.dirname(skill.location)
      const base = pathToFileURL(dir).href

      const limit = 10
      const listedFiles = await iife(async () => {
        const arr = []
        for await (const file of Ripgrep.files({
          cwd: dir,
          follow: false,
          hidden: true,
          signal: ctx.abort,
        })) {
          if (file.includes("SKILL.md")) {
            continue
          }
          arr.push(path.resolve(dir, file))
          if (arr.length >= limit) {
            break
          }
        }
        return arr
      })
      const files = listedFiles.map((file) => `<file>${file}</file>`).join("\n")

      // Build a lightweight references index from all references/*.md files, not just sampled skill_files.
      const referencePaths = await iife(async () => {
        const referencesDir = path.join(dir, "references")
        if (!(await Filesystem.exists(referencesDir))) return []
        const refs: string[] = []
        for await (const file of Ripgrep.files({
          cwd: referencesDir,
          follow: false,
          hidden: true,
          signal: ctx.abort,
        })) {
          if (!file.endsWith(".md")) continue
          refs.push(path.join("references", file))
        }
        return refs.sort((a, b) => a.localeCompare(b))
      })

      const referenceIndex = await iife(async () => {
        const entries: string[] = []
        for (const rel of referencePaths.slice(0, 30)) {
          const abs = path.resolve(dir, rel)
          const parsed = await ConfigMarkdown.parse(abs).catch(() => undefined)
          const name =
            parsed && typeof parsed.data?.name === "string" && parsed.data.name.trim().length > 0
              ? parsed.data.name.trim()
              : path.basename(rel, ".md")
          const description =
            parsed && typeof parsed.data?.description === "string" && parsed.data.description.trim().length > 0
              ? parsed.data.description.trim()
              : ""
          entries.push(
            [
              "  <reference>",
              `    <path>${abs}</path>`,
              `    <name>${name}</name>`,
              ...(description ? [`    <description>${description}</description>`] : []),
              "  </reference>",
            ].join("\n"),
          )
        }
        return entries.join("\n")
      })

      // Check that in-content references to references/*.md resolve.
      const mentionedReferenceRelPaths = Array.from(
        new Set(
          Array.from(
            skill.content.matchAll(/(?:`|\()((?:\.\/)?references\/[^`\)\s]+\.md)/g),
            (m) => m[1].replace(/^\.\//, ""),
          ),
        ),
      )
      const missingReferenceMentions = await iife(async () => {
        const missing: string[] = []
        for (const rel of mentionedReferenceRelPaths) {
          const abs = path.resolve(dir, rel)
          if (!(await Filesystem.exists(abs))) missing.push(rel)
        }
        return missing
      })
      const referenceDiagnostics =
        mentionedReferenceRelPaths.length === 0
          ? "<skill_reference_checks status=\"none\" />"
          : [
              `<skill_reference_checks status="${missingReferenceMentions.length ? "warn" : "ok"}">`,
              ...mentionedReferenceRelPaths.map((rel) =>
                missingReferenceMentions.includes(rel)
                  ? `  <missing>${rel}</missing>`
                  : `  <ok>${rel}</ok>`,
              ),
              "</skill_reference_checks>",
            ].join("\n")

      return {
        title: `Loaded skill: ${skill.name}`,
        output: [
          `<skill_content name="${skill.name}">`,
          `# Skill: ${skill.name}`,
          "",
          skill.content.trim(),
          "",
          `Base directory for this skill: ${base}`,
          "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
          "If this skill has references, read the best-matching one before specialized execution.",
          referenceDiagnostics,
          "Note: file list is sampled.",
          "",
          "<reference_index>",
          referenceIndex,
          "</reference_index>",
          "",
          "<skill_files>",
          files,
          "</skill_files>",
          "</skill_content>",
        ].join("\n"),
        metadata: {
          name: skill.name,
          dir,
        },
      }
    },
  }
})
