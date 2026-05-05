# ULMCode Rebuild Research Notes

## Base Strategy

The rebuild starts from current `upstream/dev` and layers a fresh ULMCode runtime on top. Old fork code is treated as requirements archaeology only.

Do not port the old swarm, report monolith, stale Zod tool definitions, or session environment mutations directly. Rebuild against current OpenCode APIs.

## OpenCode References To Track

- `upstream/dev` is the base.
- `upstream/nxl/background-subagents` is the reference for background task behavior. The branch-level idea adopted here is `task(background=true)` plus `task_status`.
- `#25798` cancel subtask child sessions matters for interruption safety.
- `#25768` session warping matters for future workspace/session mobility.
- `#25634` v2 message rendering matters for tool/result visibility.
- `#25787` patch boundary preservation matters for evidence-grade diffs.
- `#25712` subagent cost rollup is a future target for operation budgets.
- `#25180` subagent auto-compaction is a future target for 20-hour operation stability.

## External Cyber Harness Ideas

- CAI: specialist cybersecurity agents, agent-as-tool delegation, tracing, and guardrails.
- PentAGI: operator-visible runs, API/control-plane posture, and inspectable task state.
- PentestGPT: lab replay and Docker-first validation harnesses.
- OpenHands/SWE-agent: runtime/evaluation harness, structured action history, concise tool outputs, and raw-output persistence.
- Ralph-style loops: fresh contexts plus durable file state instead of one giant context blob.

## Adopted In This Rebuild

- `.ulmcode/operations/<operation-id>/` is the canonical operation artifact root.
- `operation_checkpoint` records stage gates and resumable heartbeats.
- `operation_status` restores context after interruptions and compaction.
- `finding_record` enforces evidence before validated/report-ready findings.
- `report_outline` gives report writers a page/section budget so final reports do not become sparse.
- `report_lint` checks report readiness and can enforce report presence and minimum density.
- `task` supports `background: true`; `task_status` polls running subagents.
- `tools/ulmcode-profile` provides an isolated K-12 pentest profile and compact skill pack.

## Not Adopted Yet

- Persistent background jobs across process restart. Current jobs are in-process; durable restart recovery should persist job metadata and child session IDs into operation artifacts.
- Cost/token rollups by operation and subagent.
- TUI operation dashboard.
- HTML/PDF final renderer.
- Lab replay harness for intentionally vulnerable targets.
- MCP/plugin vendoring beyond profile-level adoption.
