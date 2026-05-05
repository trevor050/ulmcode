const SYSTEM_NOTE = [
  "ULMCode runtime guardrails:",
  "- Start or resume authorized security operations with operation_resume before broad execution; include staleAfterMinutes and recoverStaleTasks=true for unattended resumes.",
  "- Keep durable state current with operation_checkpoint, evidence_record, finding_record, runtime_summary, operation_audit, and final handoff tools.",
  "- Prefer background task lanes for long validation/reporting work, then poll task_status or recover stale lanes with operation_resume recoverStaleTasks=true or operation_recover.",
  "- Treat sparse reports as failures: write dense, evidence-linked findings and run report_lint/report_render before handoff.",
].join("\n")

const TASK_APPEND = [
  "",
  "ULMCode background guidance:",
  "- Use background=true with operationID for long-running validation, recon, and report-review lanes.",
  "- Keep the prompt specific enough for restart/recovery because task metadata is used for stale-lane recovery.",
].join("\n")

export default {
  id: "ulmcode-runtime-guard",
  server: async () => ({
    "experimental.chat.system.transform": async (_input, output) => {
      if (!output.system.includes(SYSTEM_NOTE)) output.system.push(SYSTEM_NOTE)
    },
    "shell.env": async (_input, output) => {
      output.env.ULMCODE_PROFILE = output.env.ULMCODE_PROFILE || "1"
      output.env.OPENCODE_DISABLE_PROJECT_CONFIG = output.env.OPENCODE_DISABLE_PROJECT_CONFIG || "1"
    },
    "tool.definition": async (input, output) => {
      if (input.toolID === "task" && !output.description.includes("ULMCode background guidance")) {
        output.description += TASK_APPEND
      }
    },
  }),
}
