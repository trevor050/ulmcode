export function toULMCodeLabel(value?: string) {
  if (!value) return value ?? ""
  return value
    .replace(/OpenCode Zen/gi, "ULMCode Zen")
    .replace(/OpenCode/gi, "ULMCode")
    .replace(/opencode\.ai/gi, "ulmcode.ai")
    .replace(/opencode/gi, "ulmcode")
}
