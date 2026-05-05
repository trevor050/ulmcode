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
- `operation_status` is the post-compaction/interruption resume reader for ledgers, finding counts, reports, and recent events.
- `evidence_record` writes durable evidence JSON plus optional raw text under `evidence/`; findings should cite evidence IDs/paths from this tool rather than chat-only observations.
- `finding_record` is the evidence-backed finding state tool; validated/report-ready findings require evidence refs.
- `report_outline` creates a long-form report page budget before drafting; `report_lint` can require a report file and minimum word count to catch sparse deliverables.
- `report_render` publishes print-ready HTML, a lightweight PDF, and a manifest to `.ulmcode/operations/<id>/deliverables/final/`.
- `runtime_summary` writes `.ulmcode/operations/<id>/deliverables/runtime-summary.json` and `.md` for long-run handoff, including model-call split, compaction pressure, repeated fetches, background task state, notes, and canonical artifact paths.
- `task` supports `background: true`; list recoverable background jobs with `task_list` and poll a returned `task_id` with `task_status` for long-running subagent lanes.
- Background task metadata is persisted under storage key `background_job/<task_id>` so `task_status` can recover terminal output after a service reload; cancellation must interrupt the captured fiber before/while marking the job cancelled.
- The bundled isolated profile lives in `tools/ulmcode-profile`; validate it with `tools/ulmcode-profile/test-profile.sh`.
- Invoking the package as `ulmcode` sets `OPENCODE_APP_NAME=ulmcode`; core global paths then use the `ulmcode` app name.
