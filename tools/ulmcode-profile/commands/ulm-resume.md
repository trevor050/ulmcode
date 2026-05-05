---
description: Resume a ULMCode operation from durable state
subtask: true
---

Resume the ULMCode operation named below.

Rules:
- call `operation_resume` first
- call `operation_status` after the resume brief when you need the full ledger JSON
- call `task_list` before starting new subagents
- summarize current stage, status, health gaps, recommended tools, findings, evidence, reports, runtime summary, active background tasks, blockers, and next actions
- do not edit files unless the user explicitly asks for implementation work
- if operation state is missing, say exactly which artifact is missing

Operation:
$ARGUMENTS
