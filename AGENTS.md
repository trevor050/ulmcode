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
- `operation_resume` is the first post-compaction/restart recovery tool. It emits health gaps, recommended follow-up tools, operation-scoped tool hints, active/background tasks, and a continuation prompt before raw JSON inside `<operation_resume_json>` tags. Use `staleAfterMinutes` for unattended runs so old checkpoints and stale background jobs become explicit health gaps; restart stale operation lanes with `operation_recover`; exhausted `runtime_summary` budgets also mark the resume brief not ready and recommend `runtime_summary`.
- `operation_stage_gate` checks whether a stage is ready to continue/advance and writes `deliverables/stage-gates/<stage>.json` plus `.md`. Use it at major stage boundaries; validation blocks unresolved candidate/needs-validation findings.
- `operation_status` is the post-compaction/interruption resume reader for ledgers, finding counts, reports, runtime budget/task rollups, and recent events. It prints a compact dashboard first, then the full JSON inside `<operation_status_json>` tags.
- `operation_audit` combines restart health and final handoff lint, writes `deliverables/operation-audit.json` plus `.md`, and should be the last gate before claiming a final package is ready.
- CLI operators can inspect the same ledger outside a model turn with `opencode ulm list`, `opencode ulm status <operationID>`, `opencode ulm resume <operationID>`, `opencode ulm gate <operationID>`, and `opencode ulm audit <operationID>`; use `--format json` for machine-readable handoff.
- `evidence_record` writes durable evidence JSON plus optional raw text under `evidence/`; findings should cite evidence IDs/paths from this tool rather than chat-only observations.
- `finding_record` is the evidence-backed finding state tool; validated/report-ready findings require evidence refs.
- `report_outline` creates a long-form report page budget before drafting; `report_lint` can require a report file, total minimum word count, outline target-page budget, finding sections, and per-finding minimum word count to catch sparse deliverables. For final handoff, prefer `report_lint` with `requireOutlineBudget: true` and `finalHandoff: true` instead of remembering the separate operation-plan/render/runtime flags.
- `report_render` publishes print-ready HTML, a lightweight PDF, and a manifest to `.ulmcode/operations/<id>/deliverables/final/`.
- `runtime_summary` writes `.ulmcode/operations/<id>/deliverables/runtime-summary.json` and `.md` for long-run handoff, including model-call split, token/cost budget rollups, per-agent usage, compaction pressure, repeated fetches, background task state, restart args for stale jobs, notes, and canonical artifact paths. It auto-derives model/token/cost fields, compaction count/pressure, persisted background job state, and background job session usage from current assistant messages plus child/background subagent ledgers when those fields are omitted; explicit fields are treated as operator overrides.
- `task` supports `background: true` and optional `operationID`; list recoverable background jobs with `task_list` (pass `operationID` during ULM operations) and poll a returned `task_id` with `task_status` for long-running subagent lanes.
- Background task metadata is persisted under storage key `background_job/<task_id>` so `task_status` can recover terminal output after a service reload. If a persisted `running` job has no active fiber, it becomes `stale`; new task launches persist prompt/subagent/operation metadata so `task_status` can print restart args and `task_list` can mark stale jobs as restartable. Cancellation must interrupt the captured fiber before/while marking the job cancelled.
- `task_list` now prints `restart_args` for stale jobs when metadata is available. Prefer `operation_recover` for all stale lanes in one operation, or `task_restart` with a specific stale `task_id` for single-lane recovery after a process restart loses long-running fibers.
- `max_retries` is the config-level cap for transient session retry attempts. The bundled ULM profile sets it to 8; raise it deliberately for flaky providers, but do not leave long unattended runs able to retry forever.
- The bundled isolated profile lives in `tools/ulmcode-profile`; validate it with `tools/ulmcode-profile/test-profile.sh`. Its installer copies compact skills, ULM slash commands, plugin `package.json`, and both root/`.opencode` Oh My OpenAgent routing files.
- `bun run --cwd packages/opencode test:ulm-skills` validates bundled ULM profile skills and commands for frontmatter, placeholder-free content, and references to durable ULM tools.
- `bun run --cwd packages/opencode test:ulm-smoke` runs the synthetic ULM lifecycle smoke: plan, evidence, finding, outline, validation stage gate, final checkpoint, report render, runtime summary, operation audit, final handoff lint, and status/dashboard verification.
- `bun run --cwd packages/opencode test:ulm-lab` runs the manifest-driven lab replay harness across every `tools/ulmcode-labs/*/manifest.json`; replay final lint enforces validation stage gate, final handoff artifacts, operation audit, and the report outline budget.
- `bun run --cwd packages/opencode test:ulm-lab-target` starts and probes the bundled weak-MFA, roster-IDOR, gradebook mass-assignment, storage-config leak, student-search injection, password-reset token leak, and guardian invite takeover HTTP lab targets; Docker Compose support lives beside each lab under `tools/ulmcode-labs/<lab>/docker-compose.yml`.
- Invoking the package as `ulmcode` sets `OPENCODE_APP_NAME=ulmcode`; core global paths then use the `ulmcode` app name.
