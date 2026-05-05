---
description: Resume a ULMCode operation from durable state
subtask: true
---

Resume the ULMCode operation named below.

Rules:
- call `operation_resume` first; include `staleAfterMinutes` for unattended or long-running operations
- for unattended/long-running resumes, call `operation_resume` with `recoverStaleTasks: true` so restartable stale/error/cancelled background lanes are relaunched before you start duplicate work; use `maxRecoveries` when the operator asks for a cap
- call `operation_status` after the resume brief when you need the full ledger JSON
- call `task_list` with the operation ID before starting new subagents
- summarize current stage, status, health gaps, recommended tools, findings, evidence, reports, runtime summary, active background tasks, blockers, and next actions
- do not edit files unless the user explicitly asks for implementation work
- if operation state is missing, say exactly which artifact is missing

Operation:
$ARGUMENTS
