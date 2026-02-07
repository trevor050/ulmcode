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
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary.

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

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

## Project Memory

- Added a new primary agent `pentest_auto` (`packages/opencode/src/agent/prompt/pentest-auto.txt`) for guided penetration-test intake.
- `pentest_auto` is intended for low-friction starts: it asks only essential engagement questions first, then proceeds to planning and delegation.
- Pentest orchestration now has explicit kickoff reminders in `packages/opencode/src/session/prompt.ts`:
  - auto-intake reminder marker: `[CYBER_AUTO_INTAKE_REQUIRED_V1]`
  - pre-delegation planning reminder marker: `[CYBER_PLAN_KICKOFF_REQUIRED_V1]`
- Plan mode now has a cyber-specific reminder workflow (quick recon snapshot -> critical clarifications -> delegation plan -> `plan_exit`) when the session has a cyber environment.
- `plan_exit` no longer hardcodes return to `build`; it now routes back to the pre-plan primary agent (important for `pentest`/`pentest_auto` flows).
- `pentest_auto` now auto-kicks into plan mode on first turn (synthetic plan kickoff message), requiring plan approval (`plan_exit`) before active execution; post-approval execution target is normalized to `pentest`.
- Intake and cyber plan prompts now explicitly require targeted follow-up questions until confidence is high, while forbidding low-value/benign questioning.
- Plan-mode reminders now explicitly require using the `question` tool for clarification and follow-ups; plan approval itself is requested in normal chat text.
- `plan_exit` no longer asks a tool-driven approval question; it is now a pure mode-switch tool that should be called only after explicit user chat approval.
- Removed stale docs-site references to a built-in "Docs agent" from `packages/web/src/content/docs/agents.mdx` to match current runtime agent set.
- Tool registration now always includes `question`, `plan_enter`, and `plan_exit` regardless of `OPENCODE_CLIENT`, preventing plan sessions from failing to call `plan_exit` in nonstandard client contexts.
- Removed workspace custom docs delegate agent at `.opencode/agent/docs.md` per current workflow preference.
- Plan-exit handoff now validates the computed execution agent before switching. If prior agent resolves to an invalid/non-runnable target (for example `build` removed/overridden), handoff falls back to `pentest`, then to configured default primary agent.
- Cyber plan-exit handoff now explicitly remaps `build` -> `pentest` to avoid transient `Agent not found: build` toasts in pentest workflows.
- Plan exit now injects a pentest execution kickoff when switching to `pentest`: immediately create/update todo list, start executing plan, and delegate specialized tasks via `task` subagents.
- Default pre-plan fallback agent in plan handoff paths changed from `build` to `pentest` to avoid legacy-agent leakage in cyber workflows.
