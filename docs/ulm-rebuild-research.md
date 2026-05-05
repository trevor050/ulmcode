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
- `#25788` known-tool malformed-input classification reduces wasted agent repair loops; adopted locally.
- `#25775` Anthropic tool-call/tool-result pairing matters for tool-heavy turns; adopted locally.
- `#25712` subagent cost rollup is a future target for operation budgets.
- `#25180` subagent auto-compaction is a future target for 20-hour operation stability.
- `#25728` codex overload retry matters for provider instability during long operations; adopted locally.
- `#25805` session retry caps matter for unattended operations; adopted locally as `max_retries`.
- `#25658` SSE reconnect replay matters for long-running operation visibility; adopted locally for global event streams.
- `#25760` queued-message cancellation matters for TUI safety during busy long runs; adopted locally.
- `#25683` ACP end-turn event draining matters for external harness protocol correctness; adopted locally.
- `#25670` MCP reconnect-on-transport-error matters for long-running remote tools; adopted locally.
- `#25694` InstanceRef propagation through `ScopedCache.get` matters for context-safe long-running services; adopted locally.
- `#25672` process kill escalation and shell exit-code hang fixes matter for unattended cleanup; adopted locally against current `tool/shell.ts`.
- `#25744` npm cache name recovery matters for non-registry plugin installs; adopted locally in core npm tests.
- `#25778` config cache refresh matters for live profile/plugin edits during long runs; adopted locally with direct `getGlobal()` refresh coverage.

## External Cyber Harness Ideas

- CAI: specialist cybersecurity agents, agent-as-tool delegation, tracing, and guardrails.
- PentAGI: operator-visible runs, API/control-plane posture, and inspectable task state.
- PentestGPT: lab replay and Docker-first validation harnesses.
- OpenHands/SWE-agent: runtime/evaluation harness, structured action history, concise tool outputs, and raw-output persistence.
- Ralph-style loops: fresh contexts plus durable file state instead of one giant context blob.

## Adopted In This Rebuild

- `.ulmcode/operations/<operation-id>/` is the canonical operation artifact root.
- `operation_checkpoint` records stage gates and resumable heartbeats.
- `operation_resume` emits a compact post-compaction/restart brief with health gaps, recommended tools, operation-scoped tool hints, active/background tasks, and a continuation prompt before raw JSON. With `staleAfterMinutes`, it flags stale running checkpoints and stale background jobs before new work starts, recommends `operation_recover` for stale operation lanes, and marks exhausted runtime budgets from `runtime_summary` as blocking health gaps.
- `operation_resume` can now take `recoverStaleTasks: true` plus optional `maxRecoveries` to restart stale/error/cancelled background lanes from saved metadata before returning the refreshed brief, closing most of the manual two-step resume/recover loop when model context is available.
- `operation_status` restores context after interruptions and compaction, including runtime budget/model/task rollups when a runtime summary exists. It now emits a compact operator dashboard before the raw JSON payload.
- `operation_stage_gate` writes durable per-stage JSON/markdown gate artifacts and blocks advancement when required stage evidence is missing or validation still has unresolved candidate findings.
- `operation_audit` writes durable JSON/markdown audit artifacts that combine restart health and final handoff lint, giving long runs a hard final readiness gate.
- `opencode ulm list`, `opencode ulm status <operationID>`, `opencode ulm resume <operationID>`, `opencode ulm gate <operationID>`, and `opencode ulm audit <operationID>` expose operation discovery, dashboards, restart briefs, stage gates, and final audits directly from the CLI, with JSON output for automation.
- `/ulm/operation`, `/ulm/operation/:operationID/status`, `/resume`, and `/audit` now expose typed ULM operation dashboard data through the instance HttpApi and generated JS SDK for TUI/plugin consumers.
- The TUI now registers `ulm.operations` plus `/ulm`/`/operations`, opening a persistent operation route with list, status, audit, and report readiness panels. ULM artifact writers emit typed `operation.updated` events after durable writes so the route can update immediately from compact event payloads for checkpoints, evidence, findings, plans, reports, runtime summaries, stage gates, and audits while keeping a poll/API fallback. The compact dialog still exists for modal use.
- `operation_plan` records execution-ready phase order, success criteria, subagent/no-subagent policy, assumptions, and report closeout.
- Native ULM agents now cover primary operation control, recon, attack-path mapping, validation, evidence normalization, report writing, and adversarial report review with prompts written around durable artifacts and gate tools instead of the old swarm prompts.
- `evidence_record` writes durable evidence JSON plus optional raw text, so findings can cite recorded artifacts instead of chat-only claims.
- `finding_record` enforces evidence before validated/report-ready findings.
- `report_outline` gives report writers a page/section budget so final reports do not become sparse.
- `report_lint` checks report readiness, outline target-page budget, total and per-finding report density, evidence refs, final handoff artifacts, and `finalHandoff=true`.
- `report_render` publishes final HTML, lightweight PDF, README, manifest, evidence index, state counts, and non-reportable finding IDs.
- `runtime_summary` records model-call split, token/cost budget rollups, per-agent usage, compaction pressure, repeated fetches, background task state, stale-job restart args, notes, and canonical artifact paths. If model/token/cost, compaction, or background task fields are omitted, the tool derives them from the current session ledger, persisted child subagent sessions, persisted background job sessions, persisted background job runtime snapshots, and persisted background job ledger; explicit fields remain manual overrides. When a terminal/recoverable background lane has no readable session ledger or runtime snapshot, it adds a runtime blind-spot note instead of silently undercounting cost.
- `task` supports `background: true` plus optional `operationID`; background launches persist prompt/subagent/operation/worktree metadata; `task_status` polls running subagents and prints restart args for stale persisted jobs; `task_list` recovers persisted background job metadata, filters by operation, marks restartable orphaned jobs as `stale`, `task_restart` relaunches a specific stale lane from saved metadata, and `operation_recover` restarts all restartable stale lanes for one operation. Recovery now writes a fresh operation checkpoint with recovered task IDs when the worktree is known, so `operation_status` reflects recovery immediately.
- `max_retries` caps session-level transient model/provider retries. The isolated ULM profile sets it to 8 so 20-hour runs tolerate short provider instability without looping indefinitely.
- Malformed input for a valid tool is now routed through `invalid` with `type: "known_tool_invalid_input"` and an explicit retry hint, while nonexistent tools use `type: "unknown_tool"`.
- Anthropic/Vertex-Anthropic normalization now keeps `tool-call` and `tool-result` parts paired when splitting assistant text away from tool blocks, preventing provider rejections about orphaned tool_use IDs.
- MCP tool execution now classifies transport/stale-session failures, reconnects the named MCP client through a single-flight reconnect path, and retries the tool call once with the fresh client while preserving auth and business errors.
- Core process spawning now resolves exit waiters on `exit` as well as `close`, stops waiting after forced SIGKILL escalation, and shell execution treats exit-code read errors as terminal instead of hanging the race.
- Cached npm plugin installs now recover the actual package name from the cached install root for tarball, git, GitHub, and file specs instead of relying on registry-only name inference.
- `/global/event` now assigns SSE ids to recoverable global events and honors `Last-Event-ID` on reconnect through a 1024-event replay ring, so browser/network reconnects can catch up on missed global operation updates.
- Config file fingerprints are tracked for cached global and instance config. Changed project/global config files force reload on the next config read; `Config.invalidate()` remains safe outside an instance context.
- TUI plugins can now register `api.input.intercept(handler)` to observe prompt keydown events before built-in handling. Returning `true` consumes the event, and plugin-scoped registrations clean up on deactivate/dispose.
- Queued user messages now show a `Cancel` action that force-deletes only that queued message via the delete-message route, leaving the active assistant run alone.
- ACP prompt and command calls now wait for the corresponding assistant `message.updated` completion event before returning `end_turn`, with a bounded timeout, so clients do not receive trailing chunks after the turn is marked done.
- Session cost rollups now expose parent/session spend plus transitive descendant subagent spend through `GET /session/:id/cost`, generated SDK support, TUI sidebar cost lines, and completed Task footers.
- Session processing now estimates outgoing prompt size before opening the LLM stream and returns `compact` early when the estimate exceeds 85% of the model's reported context limit; extra z.ai/GLM-style overflow strings also classify as context overflow instead of retryable generic API errors.
- `InstanceState.get` now passes the resolved `InstanceRef` into `ScopedCache.get`, keeping lazy cache initialization aligned with the selected instance context.
- Codex/OpenAI `server_is_overloaded` stream chunks now parse as retryable API errors, and retry classification recognizes nested overloaded/rate-limit codes instead of only top-level provider codes.
- `tools/ulmcode-profile` provides an isolated K-12 pentest profile, compact skill pack, plugin dependency manifest, Oh My OpenAgent routing file, vetted local OpenCode commands, vendored profile plugins, and the local OMO markdown layer. The isolated profile now carries over the useful local OMO routing lanes: backend architect/builder, frontend taste/builder, product taste pass, sparse human-taste review, test coverage, background concurrency, runtime fallback, auto-resume, aggressive truncation, and tmux layout settings.
- The isolated profile ships a local `ulmcode-runtime-guard` server plugin that injects operation-resume, background-task, report-lint, runtime-summary, and final-handoff guardrails through OpenCode plugin hooks; it also vendors `@khalilgharbaoui/opencode-claude-code-plugin@0.2.2` and `oh-my-openagent@3.17.12` source for audit/fork work, with OMO profile dependencies pointed at the vendored copy.
- ULM artifact writers now await best-effort `operation.updated` publication after durable writes, preserving event ordering for persistent dashboards; `runtime_summary` also computes `remainingUSD` automatically when derived cost and a budget are available.
- `bun run --cwd packages/opencode test:ulm-skills` validates the bundled profile skills/commands for frontmatter, placeholder-free content, and durable ULM tool references.
- `bun run --cwd packages/opencode test:ulm-smoke` exercises a synthetic ULM lifecycle outside the unit-test helpers: operation plan, evidence, finding, report outline, validation stage gate, final render, runtime summary, operation audit, final handoff lint, and status dashboard.
- `bun run --cwd packages/opencode test:ulm-lab` replays every `tools/ulmcode-labs/*/manifest.json` into full ULM artifacts and enforces validation stage gate, final handoff, operation audit, and report outline-budget lint; current scenarios cover weak privileged MFA, roster cross-tenant read exposure, gradebook mass-assignment write escalation, storage/config leak, student-search injection, password-reset token leakage, guardian invite-code takeover, LTI shared-secret launch forgery, SIS webhook signature bypass, assignment submission impersonation, attendance bulk-update CSRF, and transcript export overexposure.
- `bun run --cwd packages/opencode test:ulm-lab-target` starts and probes every bundled intentionally weak HTTP lab target; each lab can run through its own Docker Compose file.

## Current Local OpenCode Inventory

Source checked on 2026-05-05 from `~/.config/opencode` without copying secrets.

- Installed plugin deps: `oh-my-openagent`, legacy `oh-my-opencode`, `@khalilgharbaoui/opencode-claude-code-plugin`, and `@opencode-ai/plugin`.
- Configured MCPs: Playwright local MCP, disabled Vercel remote MCP, disabled Context7 remote MCP.
- Configured LAN provider: LM Studio at `http://192.168.1.151:1234/v1` with Qwen/Qwopus local models.
- Custom global commands: `btw`, `commit-msg`, `explain-diff`, `frontend-polish`, `handoff`, `review`, `ship`, `test-plan`.
- OMO/custom-agent doctrine: GPT-5.5 for orchestration/backend/debug/review, GPT-5.4 Mini Fast for repo/docs/quick lanes, Kimi for frontend build/taste, Gemini for product/taste/writing, Claude Sonnet for sparse human-touch review, GLM as fallback orchestrator.
- Important current local rule: OpenCode markdown agents are for manual `@agent` use; automated Feature Forge style work should route through OMO category aliases.

## Not Adopted Yet

- True automatic background job execution resume across process restart. Metadata is persisted, listable, stale-aware, worktree-aware, operation-recoverable with `operation_recover`, and recoverable directly from `operation_resume` when `recoverStaleTasks` is true, but in-flight fibers are not restarted without a fresh operator/model execution context.
- Full operation-wide cost/token extraction into budgets. `runtime_summary` now derives current-session, child-session, persisted background-job-session assistant usage, persisted background-job runtime snapshots, compaction counts, background job status, and remaining budget when cost and budget are known; `operation_resume` flags exhausted recorded budgets. It still cannot recover cost/transcript data for older jobs that predate runtime snapshots and have no readable session ledger, but those lanes are now called out as explicit runtime blind spots in the summary notes.
- Broader vulnerable-target lab catalog. The catalog now has weak-MFA, roster-IDOR, gradebook mass-assignment, storage/config leak, student-search injection, password-reset token leakage, guardian invite-code takeover, LTI shared-secret launch forgery, SIS webhook signature-bypass, assignment impersonation, attendance CSRF, and transcript overexposure scenarios with Docker Compose support, but still needs more reporting-quality cases across LMS payment, messaging, and third-party integration flows.
- Full vendored third-party plugin source. The isolated profile now vendors the local OMO markdown agents/prompts/commands, Claude Code bridge plugin source, the full `oh-my-openagent@3.17.12` npm package, and a local ULM runtime guard plugin; future work should periodically refresh those vendored copies as upstream plugin versions move.
