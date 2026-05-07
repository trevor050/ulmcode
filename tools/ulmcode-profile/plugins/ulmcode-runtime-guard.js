const SYSTEM_NOTE = [
  "ULMCode runtime guardrails:",
  "- Start or resume authorized security operations with operation_resume before broad execution; include staleAfterMinutes and recoverStaleTasks=true for unattended resumes.",
  "- Create/read operation_goal and run operation_supervise for long-run startup, heartbeat, post-compaction, and pre-handoff checks.",
  "- Never run commands expected to exceed two minutes in the foreground; use command_supervise, background task lanes, operation_run, runtime_scheduler, or runtime_daemon.",
  "- Keep durable state current with operation_checkpoint, evidence_record, finding_record, runtime_summary, operation_audit, and final handoff tools.",
  "- Prefer background task lanes for long validation/reporting work, then poll task_status or recover stale lanes with operation_resume recoverStaleTasks=true or operation_recover.",
  "- Treat sparse reports as failures: write dense, evidence-linked findings and run report_lint/report_render before handoff.",
].join("\n")

const TASK_APPEND = [
  "",
  "ULMCode background guidance:",
  "- Use background=true with operationID for long-running validation, recon, and report-review lanes.",
  "- If the work can exceed two minutes, background it or use command_supervise; do not make the parent model wait.",
  "- Keep the prompt specific enough for restart/recovery because task metadata is used for stale-lane recovery.",
].join("\n")

const SHELL_APPEND = [
  "",
  "ULMCode long-command rule:",
  "- Commands expected to exceed two minutes must not run as foreground shell. Use command_supervise, task background lanes, operation_run, runtime_scheduler, or runtime_daemon.",
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
      if (input.toolID === "bash" && !output.description.includes("ULMCode long-command rule")) {
        output.description += SHELL_APPEND
      }
    },
  }),
}
