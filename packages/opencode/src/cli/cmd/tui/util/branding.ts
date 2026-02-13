export function toULMCodeLabel(value?: string) {
  if (!value) return value ?? ""
  return value
    // This is what shows in the TUI footer for the built-in local provider.
    // Keep it short and on-brand.
    .replace(/OpenCode\s+Local/gi, "ULM")
    .replace(/OpenCode Zen/gi, "ULMCode Zen")
    .replace(/OpenCode/gi, "ULMCode")
    .replace(/opencode/gi, "ulmcode")
}
