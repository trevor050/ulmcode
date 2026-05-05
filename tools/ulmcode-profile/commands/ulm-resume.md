---
description: Resume a ULMCode operation from durable state
subtask: true
---

Resume the ULMCode operation named below.

Rules:
- call `operation_status` first
- call `task_list` before starting new subagents
- summarize current stage, status, findings, evidence, reports, runtime summary, active background tasks, blockers, and next actions
- do not edit files unless the user explicitly asks for implementation work
- if operation state is missing, say exactly which artifact is missing

Operation:
$ARGUMENTS
