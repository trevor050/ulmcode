---
description: Close out a ULMCode operation with final artifacts
---

Close out the ULMCode operation named below.

Process:
1. call `operation_status`
2. call `report_lint` with `finalHandoff: true`
3. if lint gaps exist, fix the missing artifacts or explain the blocker
4. call `report_render` if final deliverables are missing or stale
5. call `runtime_summary`
6. call `report_lint` with `finalHandoff: true` again
7. summarize final paths in `deliverables/final/` and any residual risk

Do not claim final handoff is ready unless the second `report_lint` returns ok.

Operation:
$ARGUMENTS
