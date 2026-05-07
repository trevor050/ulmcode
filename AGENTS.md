- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## ULMCode Rebuild Notes

- For overnight-supervisor work, read `docs/ulm-autonomy/overnight-supervisor.md` and `docs/superpowers/plans/2026-05-06-ulm-overnight-supervisor.md` before editing; the design doc explains the supervisor runtime, and the plan tracks the supervisor/goal/tool-inventory rebuild checklist.
- The rebuild branch starts from current `upstream/dev`; old fork cyber code should be mined for requirements, not ported wholesale.
- Native ULM operation artifacts are written under `.ulmcode/operations/<operation-id>/`.
- Active ULM goals enable turn-end supervision by default: before a normal assistant stop exits `SessionPrompt.run`, the loop calls `operation_supervise` with `reviewKind=turn_end`. If the supervisor returns execution/reporting work, the loop injects a synthetic continuation instead of going idle. The no-tool continuation cap only counts continuation turns where the assistant did no tool work, so productive recovery turns can keep going until the graph/report gates are actually satisfied.
- Active ULM prompts inject the durable plan from `plans/operation-plan.json` or `.md` up to `goal.continuation.injectPlanMaxChars` (default 12,000 chars). Keep the cap char-based, not token-based.
- During unattended active operations, `Permission.ask` and `Question.ask` use `goal.continuation.operatorFallbackTimeoutSeconds` (default 75s). Permission timeouts reject with corrective feedback; question timeouts prefer skip/decline/unavailable choices, then recommended choices, and write artifacts under `operator-timeouts/`.
- `operation_checkpoint` is the durable heartbeat/stage ledger tool.
- `operation_plan` writes `plans/operation-plan.json` and `.md`; use it before broad execution to capture ordered phases, actions, success criteria, subagent/no-subagent policy, assumptions, and reporting closeout.
- `operation_resume` is the first post-compaction/restart recovery tool. It emits health gaps, recommended follow-up tools, operation-scoped tool hints, active/background tasks, and a continuation prompt before raw JSON inside `<operation_resume_json>` tags. Use `staleAfterMinutes` for unattended runs so old checkpoints and stale background jobs become explicit health gaps; pass `recoverStaleTasks: true` to relaunch restartable stale/error/cancelled lanes directly from saved metadata, or use `operation_recover` separately when you want a dedicated recovery step. Exhausted `runtime_summary` budgets and runtime blind-spot notes also mark the resume brief not ready and recommend `runtime_summary`.
- Chat todos are intentionally ephemeral: completed/cancelled items are pruned and `/clear-tasks` clears the active list. Do not rely on `todowrite` as durable ULM operation state; use operation checkpoints, stage gates, runtime summaries, and background job metadata.
- `operation_stage_gate` checks whether a stage is ready to continue/advance and writes `deliverables/stage-gates/<stage>.json` plus `.md`. Use it at major stage boundaries; it blocks exhausted runtime budgets/blind spots, validation blocks unresolved candidate/needs-validation findings, and handoff gates can forward the same strict report quality options as `report_lint`.
- `operation_status` is the post-compaction/interruption resume reader for ledgers, finding counts, reports, runtime budget/task rollups, runtime notes, and recent events. It prints a compact dashboard first, then the full JSON inside `<operation_status_json>` tags.
- `operation_audit` combines restart health and final handoff lint, writes `deliverables/operation-audit.json` plus `.md`, and should be the last gate before claiming a final package is ready. Final handoff lint now verifies package integrity too: manifest paths must match rendered artifacts, JSON files must parse, `report.pdf` must look like a PDF, `report.html` must look like HTML, and copied `deliverables/final/runtime-summary.md` must match the source runtime summary when one exists.
- CLI operators can inspect the same ledger outside a model turn with `opencode ulm list`, `opencode ulm status <operationID>`, `opencode ulm resume <operationID>`, `opencode ulm gate <operationID>`, and `opencode ulm audit <operationID>`; use `--format json` for machine-readable handoff.
- Instance HTTP API routes under `/ulm/operation` expose typed operation list, status, resume, and audit JSON for TUI/plugin dashboards. `/api/model` exposes configured/provider-registered models through the v2 HttpApi and generated JS SDK. Regenerate the JS SDK after changing either route surface.
- The TUI has a native `ulm.operations` command and `/ulm` slash entry. It opens a persistent operation dashboard route backed by the generated SDK; the route refreshes on `operation.updated` events and also polls as a fallback. The older dialog remains a compact selector/detail view.
- TUI boot regressions are part of the ULM profile gate. Run `bun run --cwd packages/opencode test:ulm-tui-launch` or `tools/ulmcode-profile/test-profile.sh` before claiming the local harness launches.
- ULM artifact writers emit `operation.updated` after durable writes for checkpoints, plans, evidence, findings, report outlines/renders, runtime summaries, stage gates, and operation audits. The event carries compact dashboard state (operation brief, counts, report flags, runtime-summary flag), and the TUI route applies that payload immediately before any API fallback refresh.
- `evidence_record` writes durable evidence JSON plus optional raw text under `evidence/`; findings should cite evidence IDs/paths from this tool rather than chat-only observations.
- `finding_record` is the evidence-backed finding state tool; validated/report-ready findings require evidence refs.
- Native ULM agents are `pentest`, `recon`, `person-recon`, `attack-map`, `validator`, `evidence`, `report-writer`, and `report-reviewer`; prompts are artifact-contracts, not old swarm carryover. Keep profile routing aligned when adding or renaming one.
- K-12 org/person recon is first-class: `district_profile` writes district/system context, `person_profile` writes public professional role profiles under `profiles/people/`, and `identity_graph` connects people/accounts/groups/roles/apps/data. Keep only engagement-relevant professional/public information; exclude private-life or irrelevant personal details.
- `report_outline` creates a long-form report page budget before drafting; the default substantial report budget is now 50 pages and includes district, people/role, and identity-graph sections. `report_lint` can require a report file, total minimum word count, outline target-page budget, required outline sections, finding sections, and per-section/per-finding minimum word counts to catch sparse deliverables. For substantial reports, prefer `report_lint` with `requireOutlineBudget: true`, `requireOutlineSections: true`, `requireFindingSections: true`, and `finalHandoff: true` instead of relying on total word count.
- `report_render` publishes print-ready HTML, an outline-aligned lightweight PDF, and a manifest to `.ulmcode/operations/<id>/deliverables/final/`. It preserves authored `reports/report.md` or `reports/report.html` when present, and the PDF text is derived from the rendered HTML body; do not reintroduce a separate skinny PDF content path.
- `runtime_summary` writes `.ulmcode/operations/<id>/deliverables/runtime-summary.json` and `.md` for long-run handoff, including model-call split, token/cost budget rollups, per-agent usage, compaction pressure, repeated fetches, background task state, restart args for stale jobs, notes, and canonical artifact paths. It auto-derives model/token/cost fields, compaction count/pressure, persisted background job state, and background job session usage from current assistant messages plus child/background subagent ledgers when those fields are omitted; explicit fields are treated as operator overrides. If a terminal background lane has no readable ledger or runtime snapshot, the tool records a runtime blind-spot note so budgets are not falsely trusted.
- `eval_scorecard` writes `.ulmcode/operations/<id>/deliverables/eval-scorecard.json` and `.md` for final ULM handoff, especially benchmark, lab, and readiness runs. Use it to record target, sandbox, allowed profiles, success criteria, artifact requirements, MITRE tags, budget, validated findings, false positives, tool failures, retries, cost, and report quality so a run is objectively scored instead of report-only.
- Observability respects operator OTEL identity: `OTEL_SERVICE_NAME` and `service.name`, `service.version`, `deployment.environment.name` in `OTEL_RESOURCE_ATTRIBUTES` should survive wrappers for long unattended runs.
- `task` supports `background: true` and optional `operationID`; list recoverable background jobs with `task_list` (pass `operationID` during ULM operations) and poll a returned `task_id` with `task_status` for long-running subagent lanes. Completed background task launches persist a compact runtime usage snapshot in job metadata so `runtime_summary` can still count the lane when the child session ledger is unavailable.
- Bare-repo-backed git worktrees intentionally cache project IDs in the bare common dir but expose the checked-out tree as `project.worktree`; do not regress this or TUI/sidebar/cwd surfaces point at the bare repo.
- Background task metadata is persisted under storage key `background_job/<task_id>` so `task_status` can recover terminal output after a service reload. If a persisted `running` job has no active fiber, it becomes `stale`; new task launches persist prompt/subagent/operation/worktree metadata so `task_status` can print restart args and `task_list` can mark stale jobs as restartable. Cancellation must interrupt the captured fiber before/while marking the job cancelled.
- `task_list` now prints `restart_args` for stale jobs when metadata is available. Prefer `operation_resume` with `recoverStaleTasks: true` or `operation_recover` for all stale lanes in one operation, or `task_restart` with a specific stale `task_id` for single-lane recovery after a process restart loses long-running fibers.
- `operation_recover` restarts matching stale/error/cancelled operation lanes and supervised command jobs. Command recovery depends on `command_supervise` metadata (`profileID`, variables, output prefix, manifest path, lane ID, workUnitID), so preserve those fields when launching commands. When it can resolve the operation worktree, it writes a fresh operation checkpoint recording recovered job IDs so `operation_status` immediately shows recovery activity.
- `max_retries` is the config-level cap for transient session retry attempts. The bundled ULM profile sets it to 8; raise it deliberately for flaky providers, but do not leave long unattended runs able to retry forever.
- Known-tool malformed input is classified separately from unknown tools via `invalid` metadata (`known_tool_invalid_input` vs `unknown_tool`). Preserve this distinction; it gives long-running agents a useful retry hint instead of generic tool failure noise.
- Anthropic/Vertex-Anthropic message normalization treats client `tool-call` and `tool-result` as one group; do not split them apart when moving trailing text, or Anthropic rejects the request. Provider-executed/server-side tool pairs must stay in assistant content.
- Moonshot/Kimi schema normalization keeps `$ref` sibling stripping and tuple-item cleanup, and flattens deeply nested complex schemas near provider depth limits so deep MCP tools do not fail before the model call.
- MCP dynamic tools retry once after recognized transport/session errors by reconnecting the MCP client. Auth/business errors should still surface directly; do not broaden `isTransportError` without focused reconnect tests.
- Core process handles resolve exit state on `exit` as well as `close`, and SIGKILL escalation does not wait forever for a close event. Preserve this, shell cleanup can otherwise hang after orphaned pipe holders.
- Shell commands that broadly kill Node.js processes are blocked by `isDangerousProcessKillCommand`; preserve this runtime guard because OpenCode itself runs on Node. PID-scoped kills and project-scoped stop commands should stay allowed.
- `Npm.add` resolves cached non-registry plugin specs from the cached install root `package.json`; do not assume `npm-package-arg` can infer names for tarballs/git/file specs.
- `/global/event` has a shared 1024-event SSE replay ring in `server/sse-replay.ts` / `server/global-event-replay.ts`. Both legacy Hono and Effect HttpApi global event routes should continue honoring `Last-Event-ID`; do not regress reconnect catch-up for long operations.
- ULM artifact writers await best-effort `operation.updated` publication after durable writes. Keep that ordering; fire-and-forget publication can race persistent TUI dashboards and tests after enriched event payloads read disk state.
- Config caching tracks file fingerprints for global and instance config. Keep `Config.invalidate()` usable without an instance context; instance config should refresh from fingerprints on the next read.
- TUI plugins can intercept prompt keydown events with `api.input.intercept(handler)`. Handlers return `true` to consume the event and are automatically disposed with the plugin scope.
- Server plugins can transform assembled chat messages with `pre_chat.messages.transform`; preserve replacement-output semantics because image-stripping and vision-summary plugins may assign a fresh `output.messages` array instead of mutating in place.
- Queued user messages should be cancelled with `session.deleteMessage(..., force: "true")`, not `session.abort`; abort is for the active run and should not be used to discard a queued prompt.
- ACP prompt/command returns wait for the completed `message.updated` event before sending `end_turn`; this keeps final streamed chunks from appearing after the RPC reply.
- Session cost rollups are served by `Session.cost` / `GET /session/:id/cost`; they include self spend plus all descendant subagent sessions and should 404 for missing root sessions.
- Session processor does a proactive pre-stream context estimate when compaction is enabled and the model reports a context limit; this prevents subagent runs from hanging on providers that silently accept oversized prompts.
- `InstanceState.get` must provide the resolved `InstanceRef` into `ScopedCache.get`; otherwise cache lookups can initialize under the right key but without the matching instance context.
- Codex/OpenAI stream chunks with `server_is_overloaded` are retryable provider overloads; keep this alongside generic `server_error` handling so unattended runs do not fail on transient overload JSON.
- Codex OAuth refresh responses may omit a new refresh token; preserve the existing token on refresh, but keep initial browser/headless OAuth flows strict so missing first-login refresh tokens fail loudly.
- `experimental.enable_sse_json_repair` is opt-in globally but enabled in `tools/ulmcode-profile`; it repairs malformed SSE `data:` JSON after strict parsing fails and should remain off by default for baseline OpenCode behavior.
- The bundled isolated profile lives in `tools/ulmcode-profile`; validate it with `tools/ulmcode-profile/test-profile.sh`. Its installer copies compact skills, ULM slash commands, the vetted local OpenCode command set, local OMO agents/prompts/Feature Forge, vendored profile plugins, plugin `package.json`, and both root/`.opencode` Oh My OpenAgent routing files. Keep the long-report skill pointed at `report_outline`, background report/evidence/review lanes, `report_lint`, `report_render`, `runtime_summary`, and `operation_audit`; it exists specifically to prevent sparse final reports.
- The isolated profile includes `plugins/ulmcode-runtime-guard.js`, which injects operation-resume, background-task, runtime-summary, report-lint/render, and final-handoff guardrails through plugin hooks. It also keeps vendored Claude Code bridge source at `tools/ulmcode-profile/plugins/vendor/opencode-claude-code-plugin-0.2.2/` and full Oh My OpenAgent package source at `tools/ulmcode-profile/plugins/vendor/oh-my-openagent-3.17.12/` for audit/fork work; profile plugin config should use `oh-my-openagent`, not `oh-my-openagent@latest`, so the vendored dependency is the one npm resolves.
- The isolated profile ships `tools/ulmcode-profile/tool-manifest.json` as the tool-acquisition and supervised-command catalog. Keep unattended profiles `non_destructive`, reserve destructive activity for `interactive_destructive`, include validation commands/fallbacks/artifact parsers for each tool, and validate it with `bun run --cwd packages/opencode test:ulm-tool-manifest`. The runtime tools are `tool_acquire` for validation/blocker recording and `command_supervise` for heartbeat/idle/hard-timeout command execution. `agent-browser` is the preferred low-context browser automation entry in the profile; Playwright remains a fallback, and unrelated Vercel/context7 MCPs should stay out of the isolated pentest profile.
- Long autonomous operations should call `operation_schedule` after `operation_plan` to create the required lane graph, then call `operation_run` as the main lane lifecycle controller. `operation_run` marks lanes running/complete/failed, can launch a selected model lane with `launchModelLane=true`, syncs background jobs with `laneID` metadata, requires lane-completion proof with explicit non-empty artifacts, writes `plans/operation-run.jsonl`, and returns background `task` parameters plus suggested command profiles. Use `operation_next` when you only need the next launch/wait/compact/stop decision without mutating lane state. The governor reads `runtime_summary` plus the graph/model catalog and returns continue/compact/stop with budget/context/model-limit blockers.
- After supervised command artifacts exist, use `evidence_normalize` before validation/reporting. It writes `evidence-index.json`, `leads.json`, and citable evidence records; leads are unverified signal and should not be promoted to findings until a validation lane confirms them.
- Use `operation_queue` after evidence normalization to convert leads into durable `work-queue.json` command units, then `operation_queue_next` to claim queued units and get exact `command_supervise` params. Preserve the returned `workUnitID` when launching commands; `operation_run` uses it to sync completed/failed background jobs back into queue state. The queue stores profile IDs and variables only, never raw shell, and refuses destructive profiles. Manual `operation_queue_next` remains dry-run by default; the scheduler/daemon owner path flips selected queued units to `dryRun:false` and starts supervised command jobs.
- Use `runtime_scheduler` for unattended progress instead of expecting the model to remember every loop step. It writes `.ulmcode/operations/<operation>/scheduler/heartbeat.json`, requeues stale claimed work units, syncs background jobs into the graph/queue, runs `operation_run`, launches prepared model lanes through background `task`, claims queued command work units into `command_supervise`, and records scheduler cycles. For real wall-clock runs, use `bun run --cwd packages/opencode ulm:runtime-daemon <operationID>`; it defaults to a 20-hour runtime window with interval sleeps, daemon lock, stale-lock recovery, stale-job recovery hooks, signal-aware shutdown, daemon heartbeats, and `scheduler/cli-launches/` records when the CLI wrapper starts scheduler-owned work. Add `--detach --json` when an operator wants a non-blocking 20-hour process handoff with pid, launch, heartbeat, and log paths. For OS-owned 20-hour runs, generate service-manager files with `bun run --cwd packages/opencode ulm:runtime-daemon <operationID> --supervisor all --json`; launchd/systemd artifacts intentionally run the foreground daemon and must not include `--detach`. `bun run --cwd packages/opencode ulm:burnin <operationID> --target-hours 20 --json` creates an accelerated proof artifact, but it is only readiness evidence, not a substitute for a literal 20-hour live run. `bun run --cwd packages/opencode ulm:literal-run-readiness <operationID> --strict --json` audits the actual wall-clock proof chain and only passes when the daemon heartbeat/log prove the target elapsed time; it writes `scheduler/literal-run-readiness.json` and `.md`.
- The profile bundles the local shell non-interactive strategy at `tools/ulmcode-profile/plugins/shell-strategy/shell_strategy.md` and loads it through `opencode.json` instructions; keep it self-contained and do not point profile installs at the user's live `~/.config/opencode`.
- `bun run --cwd packages/opencode test:ulm-skills` validates bundled ULM profile skills and commands for frontmatter, placeholder-free content, durable ULM tool references, full local workflow command coverage, shell strategy wiring, and model-routing drift.
- `bun run --cwd packages/opencode test:ulm-smoke` runs the synthetic ULM lifecycle smoke: plan, evidence, finding, outline, validation stage gate, final checkpoint, report render, runtime summary, operation audit, final handoff lint, and status/dashboard verification.
- `bun run --cwd packages/opencode test:ulm-lab` runs the manifest-driven lab replay harness across every `tools/ulmcode-labs/*/manifest.json`; replay final lint enforces validation stage gate, final handoff artifacts, operation audit, report outline budget, required outline sections, and optional authored report files. Current lab categories include authentication, roster/gradebook, storage/search/reset, guardian/LTI/SIS, assignment/attendance/transcript, LMS payment, family messaging, third-party integration flows, and at least one multi-finding chained portal case with an authored-report replay. The target-smoke harness should cover every lab service added under `tools/ulmcode-labs/*/service`.
- `bun run --cwd packages/opencode test:ulm-lab-target` starts and probes every bundled HTTP lab target; Docker Compose support lives beside each lab under `tools/ulmcode-labs/<lab>/docker-compose.yml`.
- `bun run --cwd packages/opencode test:ulm-rebuild-audit` checks the rebuild evidence checklist: upstream currency, durable ULM runtime tools, strict report gates, authored report preservation into rendered HTML/PDF, profile GPT-5.5/GPT-5.4 routing, shell strategy/local commands, profile vendoring/runtime guard, lab catalog breadth, and required gate scripts. `bun run --cwd packages/opencode script/ulm-rebuild-audit.ts --json` emits the same checklist for automation. It is a checklist verifier, not a replacement for running the actual smoke/lab/typecheck gates.
- `bun run --cwd packages/opencode test:ulm-harness:fast` runs the ULM harness scorecard added for the rebuild. It requires coverage for ten harness gaps: model-loop eval, restart/resume chaos, installed profile runtime, CI gating, longitudinal scorecards, prompt/agent regression, provider/tool chaos, dashboard/API E2E, deep lab targets, and adversarial report quality. Scenario specs live in `tools/ulmcode-evals/scenarios/`, scorecards write to `.artifacts/ulm-harness/`, and `.github/workflows/ulm-harness.yml` is the named CI surface. Additional lanes are `test:ulm-harness:full`, `test:ulm-harness:chaos`, and `test:ulm-harness:overnight`; the overnight lane is a readiness contract, while real 20-hour lab execution remains an explicit operator-triggered run.
- Invoking the package as `ulmcode` sets `OPENCODE_APP_NAME=ulmcode`; core global paths then use the `ulmcode` app name.
