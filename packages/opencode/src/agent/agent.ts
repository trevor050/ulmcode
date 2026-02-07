import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_ASSESS from "./prompt/assess.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EVIDENCE_SCRIBE from "./prompt/evidence-scribe.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_HOST_AUDITOR from "./prompt/host-auditor.txt"
import PROMPT_NETWORK_MAPPER from "./prompt/network-mapper.txt"
import PROMPT_PENTEST from "./prompt/pentest.txt"
import PROMPT_PENTEST_AUTO from "./prompt/pentest-auto.txt"
import PROMPT_RECON from "./prompt/recon.txt"
import PROMPT_REPORT from "./prompt/report.txt"
import PROMPT_REPORT_WRITER from "./prompt/report-writer.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_VULN_RESEARCHER from "./prompt/vuln-researcher.txt"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@/global"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const skillDirs = await Skill.dirs()
    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      bash_sensitive: "ask",
      doom_loop: "ask",
      finding: "deny",
      external_directory: {
        "*": "ask",
        [Truncate.GLOB]: "allow",
        ...Object.fromEntries(skillDirs.map((dir) => [path.join(dir, "*"), "allow"])),
      },
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, Info> = {
      build: {
        name: "build",
        description: "The default agent. Executes tools based on configured permissions.",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      plan: {
        name: "plan",
        description: "Plan mode. Disallows all edit tools.",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_exit: "allow",
            external_directory: {
              [path.join(Global.Path.data, "plans", "*")]: "allow",
            },
            edit: {
              "*": "deny",
              [path.join(".opencode", "plans", "*.md")]: "allow",
              [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
            },
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      pentest: {
        name: "pentest",
        description:
          "Primary cyber orchestrator for internal authorized engagements. Coordinates recon, validation, evidence, and reporting.",
        prompt: PROMPT_PENTEST,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
            task: "allow",
            finding: "allow",
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "primary",
        native: true,
      },
      pentest_flow: {
        name: "pentest_flow",
        description:
          "Primary cyber orchestrator with guided intake. Starts with essential pentest questions, then plans and delegates.",
        prompt: PROMPT_PENTEST_AUTO,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
            task: "allow",
            finding: "allow",
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "primary",
        native: true,
      },
      pentest_auto: {
        name: "pentest_auto",
        description: "Deprecated alias for pentest_flow.",
        prompt: PROMPT_PENTEST_AUTO,
        hidden: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
            task: "allow",
            finding: "allow",
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "primary",
        native: true,
      },
      recon: {
        name: "recon",
        description: "Subagent for safe internal attack-surface discovery and enumeration.",
        prompt: PROMPT_RECON,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            bash: "allow",
            edit: {
              "*": "deny",
              "*/engagements/*/handoff.md": "allow",
              "*/engagements/*/agents/*/results.md": "allow",
              "*/engagements/*/reports/*": "allow",
            },
            finding: "allow",
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      assess: {
        name: "assess",
        description: "Subagent for validation, exploitability analysis, and impact triage.",
        prompt: PROMPT_ASSESS,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            bash: "allow",
            edit: {
              "*": "deny",
              "*/engagements/*/handoff.md": "allow",
              "*/engagements/*/agents/*/results.md": "allow",
              "*/engagements/*/reports/*": "allow",
            },
            finding: "allow",
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      report: {
        name: "report",
        description: "Subagent for reporting, evidence normalization, and remediation framing.",
        prompt: PROMPT_REPORT,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            bash: "allow",
            edit: {
              "*": "deny",
              "*/engagements/*/handoff.md": "allow",
              "*/engagements/*/agents/*/results.md": "allow",
              "*/engagements/*/reports/*": "allow",
            },
            finding: "allow",
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      analyst: {
        name: "analyst",
        description: "Compatibility alias for assess agent behavior.",
        prompt: PROMPT_ASSESS,
        hidden: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            bash: "allow",
            edit: {
              "*": "deny",
              "*/engagements/*/handoff.md": "allow",
              "*/engagements/*/agents/*/results.md": "allow",
              "*/engagements/*/reports/*": "allow",
            },
            finding: "allow",
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      network_mapper: {
        name: "network_mapper",
        description: "Subagent for network enumeration and attack-surface mapping.",
        prompt: PROMPT_NETWORK_MAPPER,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            edit: {
              "*": "deny",
              "*/engagements/*/handoff.md": "allow",
              "*/engagements/*/agents/*/results.md": "allow",
              "*/engagements/*/reports/*": "allow",
            },
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      host_auditor: {
        name: "host_auditor",
        description: "Subagent for host-level posture and misconfiguration auditing.",
        prompt: PROMPT_HOST_AUDITOR,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            edit: {
              "*": "deny",
              "*/engagements/*/handoff.md": "allow",
              "*/engagements/*/agents/*/results.md": "allow",
              "*/engagements/*/reports/*": "allow",
            },
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      vuln_researcher: {
        name: "vuln_researcher",
        description: "Subagent for exploitability and CVE validation research.",
        prompt: PROMPT_VULN_RESEARCHER,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            edit: {
              "*": "deny",
              "*/engagements/*/handoff.md": "allow",
              "*/engagements/*/agents/*/results.md": "allow",
              "*/engagements/*/reports/*": "allow",
            },
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      evidence_scribe: {
        name: "evidence_scribe",
        description: "Subagent for evidence normalization and finding log quality.",
        prompt: PROMPT_EVIDENCE_SCRIBE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            edit: "allow",
            finding: "allow",
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      report_writer: {
        name: "report_writer",
        description: "Final reporting specialist for full client-grade synthesis and PDF deliverables.",
        prompt: PROMPT_REPORT_WRITER,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            list: "allow",
            glob: "allow",
            grep: "allow",
            bash: "allow",
            edit: "allow",
            write: "allow",
            finding: "allow",
            webfetch: "allow",
            websearch: "allow",
            task: "deny",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      explore: {
        name: "explore",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            read: "allow",
            external_directory: {
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "subagent",
        native: true,
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        options: {},
      },
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_TITLE,
      },
      summary: {
        name: "summary",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_SUMMARY,
      },
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.variant = value.variant ?? item.variant
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
    }

    // Ensure Truncate.GLOB is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    )
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (agent.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return agent.name
    }

    const primaryVisible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) throw new Error("no primary visible agent found")
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = [PROMPT_GENERATE]
    await Plugin.trigger("experimental.chat.system.transform", { model }, { system })
    const existing = await list()

    const params = {
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    } satisfies Parameters<typeof generateObject>[0]

    if (defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth") {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          instructions: SystemPrompt.instructions(),
          store: false,
        }),
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return result.object
    }

    const result = await generateObject(params)
    return result.object
  }
}
