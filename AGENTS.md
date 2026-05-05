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

- The rebuild branch starts from current `upstream/dev`; old fork cyber code should be mined for requirements, not ported wholesale.
- Native ULM operation artifacts are written under `.ulmcode/operations/<operation-id>/`.
- `operation_checkpoint` is the durable heartbeat/stage ledger tool.
- `operation_plan` writes `plans/operation-plan.json` and `.md`; use it before broad execution to capture ordered phases, actions, success criteria, subagent/no-subagent policy, assumptions, and reporting closeout.
- `operation_resume` is the first post-compaction/restart recovery tool. It emits health gaps, recommended follow-up tools, operation-scoped tool hints, active/background tasks, and a continuation prompt before raw JSON inside `<operation_resume_json>` tags. Use `staleAfterMinutes` for unattended runs so old checkpoints and stale background jobs become explicit health gaps; pass `recoverStaleTasks: true` to relaunch restartable stale/error/cancelled lanes directly from saved metadata, or use `operation_recover` separately when you want a dedicated recovery step. Exhausted `runtime_summary` budgets and runtime blind-spot notes also mark the resume brief not ready and recommend `runtime_summary`.
- `operation_stage_gate` checks whether a stage is ready to continue/advance and writes `deliverables/stage-gates/<stage>.json` plus `.md`. Use it at major stage boundaries; it blocks exhausted runtime budgets/blind spots, validation blocks unresolved candidate/needs-validation findings, and handoff gates can forward the same strict report quality options as `report_lint`.
- `operation_status` is the post-compaction/interruption resume reader for ledgers, finding counts, reports, runtime budget/task rollups, runtime notes, and recent events. It prints a compact dashboard first, then the full JSON inside `<operation_status_json>` tags.
- `operation_audit` combines restart health and final handoff lint, writes `deliverables/operation-audit.json` plus `.md`, and should be the last gate before claiming a final package is ready.
- CLI operators can inspect the same ledger outside a model turn with `opencode ulm list`, `opencode ulm status <operationID>`, `opencode ulm resume <operationID>`, `opencode ulm gate <operationID>`, and `opencode ulm audit <operationID>`; use `--format json` for machine-readable handoff.
- Instance HTTP API routes under `/ulm/operation` expose typed operation list, status, resume, and audit JSON for TUI/plugin dashboards. Regenerate the JS SDK after changing this route surface.
- The TUI has a native `ulm.operations` command and `/ulm` slash entry. It opens a persistent operation dashboard route backed by the generated SDK; the route refreshes on `operation.updated` events and also polls as a fallback. The older dialog remains a compact selector/detail view.
- ULM artifact writers emit `operation.updated` after durable writes for checkpoints, plans, evidence, findings, report outlines/renders, runtime summaries, stage gates, and operation audits. The event carries compact dashboard state (operation brief, counts, report flags, runtime-summary flag), and the TUI route applies that payload immediately before any API fallback refresh.
- `evidence_record` writes durable evidence JSON plus optional raw text under `evidence/`; findings should cite evidence IDs/paths from this tool rather than chat-only observations.
- `finding_record` is the evidence-backed finding state tool; validated/report-ready findings require evidence refs.
- Native ULM agents are `pentest`, `recon`, `attack-map`, `validator`, `evidence`, `report-writer`, and `report-reviewer`; prompts are artifact-contracts, not old swarm carryover. Keep profile routing aligned when adding or renaming one.
- `report_outline` creates a long-form report page budget before drafting; `report_lint` can require a report file, total minimum word count, outline target-page budget, required outline sections, finding sections, and per-section/per-finding minimum word counts to catch sparse deliverables. For substantial reports, prefer `report_lint` with `requireOutlineBudget: true`, `requireOutlineSections: true`, `requireFindingSections: true`, and `finalHandoff: true` instead of relying on total word count.
- `report_render` publishes print-ready HTML, a lightweight PDF, and a manifest to `.ulmcode/operations/<id>/deliverables/final/`.
- `runtime_summary` writes `.ulmcode/operations/<id>/deliverables/runtime-summary.json` and `.md` for long-run handoff, including model-call split, token/cost budget rollups, per-agent usage, compaction pressure, repeated fetches, background task state, restart args for stale jobs, notes, and canonical artifact paths. It auto-derives model/token/cost fields, compaction count/pressure, persisted background job state, and background job session usage from current assistant messages plus child/background subagent ledgers when those fields are omitted; explicit fields are treated as operator overrides. If a terminal background lane has no readable ledger or runtime snapshot, the tool records a runtime blind-spot note so budgets are not falsely trusted.
- `task` supports `background: true` and optional `operationID`; list recoverable background jobs with `task_list` (pass `operationID` during ULM operations) and poll a returned `task_id` with `task_status` for long-running subagent lanes. Completed background task launches persist a compact runtime usage snapshot in job metadata so `runtime_summary` can still count the lane when the child session ledger is unavailable.
- Background task metadata is persisted under storage key `background_job/<task_id>` so `task_status` can recover terminal output after a service reload. If a persisted `running` job has no active fiber, it becomes `stale`; new task launches persist prompt/subagent/operation/worktree metadata so `task_status` can print restart args and `task_list` can mark stale jobs as restartable. Cancellation must interrupt the captured fiber before/while marking the job cancelled.
- `task_list` now prints `restart_args` for stale jobs when metadata is available. Prefer `operation_recover` for all stale lanes in one operation, or `task_restart` with a specific stale `task_id` for single-lane recovery after a process restart loses long-running fibers.
- `operation_recover` restarts matching stale/error/cancelled operation lanes and, when it can resolve the operation worktree, writes a fresh operation checkpoint recording recovered task IDs so `operation_status` immediately shows recovery activity.
- `max_retries` is the config-level cap for transient session retry attempts. The bundled ULM profile sets it to 8; raise it deliberately for flaky providers, but do not leave long unattended runs able to retry forever.
- Known-tool malformed input is classified separately from unknown tools via `invalid` metadata (`known_tool_invalid_input` vs `unknown_tool`). Preserve this distinction; it gives long-running agents a useful retry hint instead of generic tool failure noise.
- Anthropic/Vertex-Anthropic message normalization treats `tool-call` and `tool-result` as one group; do not split them apart when moving trailing text, or Anthropic rejects the request.
- MCP dynamic tools retry once after recognized transport/session errors by reconnecting the MCP client. Auth/business errors should still surface directly; do not broaden `isTransportError` without focused reconnect tests.
- Core process handles resolve exit state on `exit` as well as `close`, and SIGKILL escalation does not wait forever for a close event. Preserve this, shell cleanup can otherwise hang after orphaned pipe holders.
- `Npm.add` resolves cached non-registry plugin specs from the cached install root `package.json`; do not assume `npm-package-arg` can infer names for tarballs/git/file specs.
- `/global/event` has a shared 1024-event SSE replay ring in `server/sse-replay.ts` / `server/global-event-replay.ts`. Both legacy Hono and Effect HttpApi global event routes should continue honoring `Last-Event-ID`; do not regress reconnect catch-up for long operations.
- ULM artifact writers await best-effort `operation.updated` publication after durable writes. Keep that ordering; fire-and-forget publication can race persistent TUI dashboards and tests after enriched event payloads read disk state.
- Config caching tracks file fingerprints for global and instance config. Keep `Config.invalidate()` usable without an instance context; instance config should refresh from fingerprints on the next read.
- TUI plugins can intercept prompt keydown events with `api.input.intercept(handler)`. Handlers return `true` to consume the event and are automatically disposed with the plugin scope.
- Queued user messages should be cancelled with `session.deleteMessage(..., force: "true")`, not `session.abort`; abort is for the active run and should not be used to discard a queued prompt.
- ACP prompt/command returns wait for the completed `message.updated` event before sending `end_turn`; this keeps final streamed chunks from appearing after the RPC reply.
- Session cost rollups are served by `Session.cost` / `GET /session/:id/cost`; they include self spend plus all descendant subagent sessions and should 404 for missing root sessions.
- Session processor does a proactive pre-stream context estimate when compaction is enabled and the model reports a context limit; this prevents subagent runs from hanging on providers that silently accept oversized prompts.
- `InstanceState.get` must provide the resolved `InstanceRef` into `ScopedCache.get`; otherwise cache lookups can initialize under the right key but without the matching instance context.
- Codex/OpenAI stream chunks with `server_is_overloaded` are retryable provider overloads; keep this alongside generic `server_error` handling so unattended runs do not fail on transient overload JSON.
- The bundled isolated profile lives in `tools/ulmcode-profile`; validate it with `tools/ulmcode-profile/test-profile.sh`. Its installer copies compact skills, ULM slash commands, the vetted local OpenCode command set, local OMO agents/prompts/Feature Forge, vendored profile plugins, plugin `package.json`, and both root/`.opencode` Oh My OpenAgent routing files. Keep the long-report skill pointed at `report_outline`, background report/evidence/review lanes, `report_lint`, `report_render`, `runtime_summary`, and `operation_audit`; it exists specifically to prevent sparse final reports.
- The isolated profile includes `plugins/ulmcode-runtime-guard.js`, which injects operation-resume, background-task, runtime-summary, report-lint/render, and final-handoff guardrails through plugin hooks. It also keeps vendored Claude Code bridge source at `tools/ulmcode-profile/plugins/vendor/opencode-claude-code-plugin-0.2.2/` and full Oh My OpenAgent package source at `tools/ulmcode-profile/plugins/vendor/oh-my-openagent-3.17.12/` for audit/fork work; profile plugin config should use `oh-my-openagent`, not `oh-my-openagent@latest`, so the vendored dependency is the one npm resolves.
- `bun run --cwd packages/opencode test:ulm-skills` validates bundled ULM profile skills and commands for frontmatter, placeholder-free content, and references to durable ULM tools.
- `bun run --cwd packages/opencode test:ulm-smoke` runs the synthetic ULM lifecycle smoke: plan, evidence, finding, outline, validation stage gate, final checkpoint, report render, runtime summary, operation audit, final handoff lint, and status/dashboard verification.
- `bun run --cwd packages/opencode test:ulm-lab` runs the manifest-driven lab replay harness across every `tools/ulmcode-labs/*/manifest.json`; replay final lint enforces validation stage gate, final handoff artifacts, operation audit, report outline budget, and required outline sections. Current lab categories include authentication, roster/gradebook, storage/search/reset, guardian/LTI/SIS, assignment/attendance/transcript, LMS payment, family messaging, third-party integration flows, and at least one multi-finding chained portal case. The target-smoke harness should cover every lab service added under `tools/ulmcode-labs/*/service`.
- `bun run --cwd packages/opencode test:ulm-lab-target` starts and probes every bundled HTTP lab target; Docker Compose support lives beside each lab under `tools/ulmcode-labs/<lab>/docker-compose.yml`.
- `bun run --cwd packages/opencode test:ulm-rebuild-audit` checks the rebuild evidence checklist: upstream currency, durable ULM runtime tools, strict report gates, profile vendoring/runtime guard, lab catalog breadth, and required gate scripts. It is a checklist verifier, not a replacement for running the actual smoke/lab/typecheck gates.
- Invoking the package as `ulmcode` sets `OPENCODE_APP_NAME=ulmcode`; core global paths then use the `ulmcode` app name.
