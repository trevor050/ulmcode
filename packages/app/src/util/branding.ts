export function toULMCodeLabel(value?: string) {
  if (!value) return value ?? ""
  return value
    .replace(/OpenCode\s*local/gi, "ULM")
    .replace(/OpenCode\s+Local/gi, "ULM")
    .replace(/OpenCode Zen/gi, "ULMCode Zen")
    .replace(/OpenCode/gi, "ULMCode")
    .replace(/opencode/gi, "ulmcode")
}
