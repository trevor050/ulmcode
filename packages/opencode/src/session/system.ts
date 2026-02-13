import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import PROMPT_CYBER_CORE from "./prompt/cyber-core.txt"
import type { Provider } from "@/provider/provider"
import { ToolingInventory } from "./tooling"

export namespace SystemPrompt {
  type Options = {
    includeCyber?: boolean
  }

  function withCyber(base: string[], options?: Options) {
    if (options?.includeCyber === false) return base
    return [...base, PROMPT_CYBER_CORE]
  }

  export function cyberCore() {
    return PROMPT_CYBER_CORE
  }

  export function instructions(options?: Options) {
    return withCyber([PROMPT_CODEX], options)
      .map((x) => x.trim())
      .join("\n\n")
  }

  export function provider(model: Provider.Model, options?: Options) {
    if (model.api.id.includes("gpt-5")) return withCyber([PROMPT_CODEX], options)
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return withCyber([PROMPT_BEAST], options)
    if (model.api.id.includes("gemini-")) return withCyber([PROMPT_GEMINI], options)
    if (model.api.id.includes("claude")) return withCyber([PROMPT_ANTHROPIC], options)
    if (model.api.id.toLowerCase().includes("trinity")) return withCyber([PROMPT_TRINITY], options)
    return withCyber([PROMPT_ANTHROPIC_WITHOUT_TODO], options)
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    const tooling = await ToolingInventory.render().catch(() => "")
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        tooling ? tooling : "",
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
      ].join("\n"),
    ]
  }
}
