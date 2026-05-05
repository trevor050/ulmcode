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
- `operation_resume` emits a compact post-compaction/restart brief with health gaps, recommended tools, active/background tasks, and a continuation prompt before raw JSON. With `staleAfterMinutes`, it also flags stale running checkpoints and stale background jobs before new work starts.
- `operation_status` restores context after interruptions and compaction, including runtime budget/model/task rollups when a runtime summary exists. It now emits a compact operator dashboard before the raw JSON payload.
- `operation_plan` records execution-ready phase order, success criteria, subagent/no-subagent policy, assumptions, and report closeout.
- `evidence_record` writes durable evidence JSON plus optional raw text, so findings can cite recorded artifacts instead of chat-only claims.
- `finding_record` enforces evidence before validated/report-ready findings.
- `report_outline` gives report writers a page/section budget so final reports do not become sparse.
- `report_lint` checks report readiness, total and per-finding report density, evidence refs, final handoff artifacts, and `finalHandoff=true`.
- `report_render` publishes final HTML, lightweight PDF, README, manifest, evidence index, state counts, and non-reportable finding IDs.
- `runtime_summary` records model-call split, token/cost budget rollups, per-agent usage, compaction pressure, repeated fetches, background task state, notes, and canonical artifact paths. If model/token/cost, compaction, or background task fields are omitted, the tool derives them from the current session ledger, persisted child subagent sessions, and persisted background job ledger; explicit fields remain manual overrides.
- `task` supports `background: true`; `task_status` polls running subagents; `task_list` recovers persisted background job metadata and marks orphaned running jobs as `stale`.
- `tools/ulmcode-profile` provides an isolated K-12 pentest profile, compact skill pack, plugin dependency manifest, and Oh My OpenAgent routing file.
- `bun run --cwd packages/opencode test:ulm-skills` validates the bundled profile skills/commands for frontmatter, placeholder-free content, and durable ULM tool references.
- `bun run --cwd packages/opencode test:ulm-smoke` exercises a synthetic ULM lifecycle outside the unit-test helpers: operation plan, evidence, finding, report outline, final render, runtime summary, final handoff lint, and status dashboard.
- `bun run --cwd packages/opencode test:ulm-lab` replays a manifest-driven synthetic lab from `tools/ulmcode-labs/k12-login-mfa-gap/manifest.json` into full ULM artifacts and final handoff lint.
- `bun run --cwd packages/opencode test:ulm-lab-target` starts and probes the bundled intentionally weak MFA HTTP lab target; the same lab can run through Docker Compose.

## Current Local OpenCode Inventory

Source checked on 2026-05-05 from `~/.config/opencode` without copying secrets.

- Installed plugin deps: `oh-my-openagent`, legacy `oh-my-opencode`, `@khalilgharbaoui/opencode-claude-code-plugin`, and `@opencode-ai/plugin`.
- Configured MCPs: Playwright local MCP, disabled Vercel remote MCP, disabled Context7 remote MCP.
- Configured LAN provider: LM Studio at `http://192.168.1.151:1234/v1` with Qwen/Qwopus local models.
- Custom global commands: `btw`, `commit-msg`, `explain-diff`, `frontend-polish`, `handoff`, `review`, `ship`, `test-plan`.
- OMO/custom-agent doctrine: GPT-5.5 for orchestration/backend/debug/review, GPT-5.4 Mini Fast for repo/docs/quick lanes, Kimi for frontend build/taste, Gemini for product/taste/writing, Claude Sonnet for sparse human-touch review, GLM as fallback orchestrator.
- Important current local rule: OpenCode markdown agents are for manual `@agent` use; automated Feature Forge style work should route through OMO category aliases.

## Not Adopted Yet

- True background job execution resume across process restart. Metadata is persisted, listable, and stale-aware, but in-flight fibers are not restarted after process death.
- Full operation-wide cost/token extraction into budgets. `runtime_summary` now derives current-session and child-session assistant message usage, compaction counts, and background job status, but it does not yet recover transcripts from long-dead background jobs that no longer have a reachable session tree.
- Full TUI operation dashboard. The tool output now has a compact dashboard, but there is not yet a dedicated interactive TUI route.
- Larger vulnerable-target lab catalog. The first weak-MFA HTTP target ships with Docker Compose support, but the catalog is still one scenario.
- Full vendored plugin source. The isolated profile records plugin dependencies and routing, but does not vendor third-party plugin code into this repo.
