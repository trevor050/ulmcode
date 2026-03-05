# ULMcode Agents Notes

Last updated: 2026-03-05

## Repo Reality (Read This First)
- `/Users/trevorrosato/codeprojects/ULMcode/` is a workspace container only (not a git repo).
- The actual git repo root is `/Users/trevorrosato/codeprojects/ULMcode/opencode/`.
- Always `cd opencode` (or run `git -C opencode ...`) before doing git work to avoid committing to the void.

## Project Summary
- Repo root: `opencode/` (fork of OpenCode).
- Primary customization area: `packages/opencode` (ULM cybersecurity harness + orchestration behavior).
- Product intent: evidence-first, non-destructive-by-default internal pentest orchestration with guided operator flow.

## Key Architecture
- `packages/opencode`: core runtime, session orchestration, tool routing, reporting, cyber agent behavior.
- `packages/app`: web UI.
- `packages/desktop`: desktop app shell.
- `tools/ulmcode-profile`: skill profile + bootstrap sync scripts used by runtime harness.

## Installer + Profile (Field Setup)
- Bash installer: `install` (downloads GitHub release assets + skills bundle, installs `ulmcode`, initializes profile).
- PowerShell installer: `install.ps1` (Windows native).
- Skills bundle script: `tools/ulmcode-profile/scripts/build-skills-bundle.sh` -> `ulmcode-skills.tar.gz`.
- Profile initializer CLI: `ulmcode profile init` (writes `~/.config/ulmcode/opencode.json` + launchers, allowlists skills, configures MCP).
- Upgrade path for distributed fork users: `ulmcode upgrade` (alias: `ulmcode update`).
- Upgrade command resilience: when install method detection is `unknown`, CLI now falls back to `curl` installer flow (instead of erroring on `unknown` method).

## Current Behavior Snapshot
- `pentest` is the default guided mode when no explicit agent is set.
- Guided flow is plan-first and requires explicit confirmation before execution handoff (`plan_exit`).
- Engagement scaffold must maintain required artifacts (`finding.md`, `handoff.md`, `engagement.md`, evidence folders, agent results, reports).
- Reporting flow is enforced; `report_writer` must run before finalization.

## Swarm Foundation Phase 1 (2026-02-18)
- Implemented hard bash guardrails:
  - default timeout remains 2 minutes,
  - hard max timeout is now 30 minutes (clamped when exceeded),
  - checkpoint runtime metadata emitted at 5/10/15/20/25/30 minute marks.
- Added cyber config surface for runtime controls:
  - `cyber.command_timeout_default_ms`
  - `cyber.command_timeout_max_ms`
  - `cyber.command_checkpoint_minutes`
  - `cyber.enforce_scan_safety_defaults`
  - `cyber.background_task.*` concurrency + stale timeout settings.
- Added scan safety policy option:
  - when enabled, blocks unsafe default-first scan patterns (`nmap -p-`, `--script=vuln`, unbounded `masscan`).
- Added subagent telemetry standardization for `task`:
  - `sessionId`, `parentSessionId`, `agent`, `model`, `startedAt`, `endedAt`, `durationMs`, `status`, `errorType`, plus background task linkage.
- Added subagent reliability improvements:
  - task execution races normal prompt completion with terminal message recovery to prevent parent hangs.
  - assistant error payloads now throw from `task` so parent receives explicit failure instead of silent empty results.
- Added background swarm toolchain:
  - tools: `background_list`, `background_output`, `background_cancel`
  - manager: `packages/opencode/src/features/background-agent/manager.ts`
  - `task` now supports `run_in_background`, `coordination_scope`, `expected_output_schema`, `teammate_targets`, `allow_scope_overlap`.
- Added cross-subagent coordination contract:
  - `engagements/<id>/agents/coordination/task-graph.json`
  - `engagements/<id>/agents/coordination/inbox/<session-id>.jsonl`
  - scope claims are blocked on overlap unless explicitly overridden.
- Added deliverables-first reporting publish path:
  - report authoring remains in `reports/`,
  - `report_finalize` now publishes final client artifacts to `deliverables/final/`,
  - archives full report bundle snapshots to `deliverables/archive/<timestamp>/`.
- Added engagement hygiene/indexing:
  - `engagements/index.json` now maintained with session/root/status/mode/final PDF path.
  - scaffold now creates `deliverables/final` and `deliverables/archive`.
  - noise cleanup routine removes empty runtime artifacts in tmp/agents surfaces.
- Branding coverage expanded:
  - TUI/local provider labeling hardened for `OpenCode local` -> `ULM`.
  - TUI sidebar footer brand mark is hardcoded in `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx`; keep it as `ULM` (do not reintroduce split `Open` + `Code` tags).
- app-side provider/model labels now route through shared branding helper.

## Swarm Overhaul Phase 2 (2026-02-18, in progress)
- Added V2 swarm domain modules under `packages/opencode/src/features/swarm/`:
  - `team-manager.ts`, `mesh-router.ts`, `identity.ts`, `scheduler.ts`, `inbox.ts`, `watchdog.ts`, `tmux.ts`, `telemetry.ts`
  - SQLite schema in `swarm.sql.ts` with migration `migration/20260218153000_swarm_v2_foundation/migration.sql`.
- Added `cyber.swarm_v2.*` config and env gates:
  - `enabled`, `dual_write_legacy_files`, `sqlite_read_canonical`, `tmux_default_enabled`, `high_autonomy`, `default_topology`.
- `task` tool now supports additive V2 routing fields:
  - `team_id`, `caller_id`, `delegation_mode`, `isolation_mode`, `retry_policy`
  - existing V1 fields remain compatible (`run_in_background`, `coordination_scope`, `expected_output_schema`, `teammate_targets`, `allow_scope_overlap`).
- `task` now emits/propagates caller chain + delegation depth and can route through mesh (`direct`) or inbox (`brokered`) messaging.
- Background manager now persists richer swarm task metadata and handles claim lifecycle release on completion/failure/cancel/stale timeout.
- Added full team tool surface and registry wiring:
  - `team_create`, `team_update`, `team_list`, `team_members`, `team_message`, `team_status`, `team_pause`, `team_resume`, `team_stop`.
- Background tools are async-safe now and include team/delegation metadata in outputs:
  - `background_list`, `background_output`, `background_cancel`.
- New tests:
  - `packages/opencode/test/tool/team-tools.test.ts`
  - `packages/opencode/test/tool/background-tools.test.ts` (updated for async manager API).
- Important gotcha:
  - Swarm telemetry writes are now gated by `swarm_v2.enabled`, with FK-safe fallback that drops invalid refs into payload metadata instead of crashing runs.

## Swarm Revision Phase 2.1 (2026-02-18)
- Added mandatory pentest plan-time swarm aggression intake on `plan_exit` (once per engagement by default):
  - options: `none`, `low`, `balanced`, `high`, `max_parallel`
  - enforced in `packages/opencode/src/tool/plan.ts` when `cyber.swarm_v2_1.enabled=true`.
  - fallback behavior: if question plumbing is unavailable, plan exit logs `swarm_aggression_warning` and safely persists default aggression.
- Engagement-scoped policy now persists at:
  - `engagements/<id>/agents/coordination/swarm-policy.json`
  - helper APIs in `packages/opencode/src/session/environment.ts`:
    - `resolveSwarmPolicyPath()`
    - `readSwarmPolicy()`
    - `writeSwarmPolicy()`
- Added canonical aggression policy mapping in:
  - `packages/opencode/src/features/swarm/aggression.ts`
  - runtime defaults:
    - `none` => no delegation, no background tasks, depth 0
    - `low` => background 2, depth 1
    - `balanced` => background 4, depth 2
    - `high` => background 8, depth 3
    - `max_parallel` => planner-unbounded background (still provider/model constrained), depth cap from config (default 4)
- `task` tool now supports optional `swarm_aggression_override` (restricted to operator/planner-style agents), with metadata/provenance:
  - `swarmAggression`, `aggressionSource`, `maxActiveBackground`, `maxDelegationDepth`
- Background/task persistence and outputs include aggression metadata:
  - DB migration: `packages/opencode/migration/20260218190000_swarm_v21_aggression/migration.sql`
  - `swarm_task` columns added: `swarm_aggression`, `aggression_source`, `max_active_background`, `max_delegation_depth`
  - `background_list` and `background_output` print aggression context.
- Added `cyber.swarm_v2_1.*` config + env flags:
  - `enabled`
  - `default_aggression`
  - `ask_aggression_on_plan_exit`
  - `max_parallel_depth_cap`
- Report provenance now includes swarm policy snapshot sidecar:
  - `reports/swarm-quality.json`
  - copied into final deliverables during `report_finalize`.

## Swarm Revision Phase 2.1.1 (2026-02-19)
- Seamless plan/pentest handoff stabilization:
  - `plan_exit` now no-ops when session is not currently in `plan` mode (prevents accidental pentest-mode misuse).
  - session processor fallback now detects explicit user approval intent (for example: "go ahead", "approved", "proceed") and auto-recovers from literal `plan_exit` text outputs.
  - fallback recovery no longer depends strictly on current assistant agent being `plan`; it also checks recent plan context.
- Swarm aggression UX and normalization improvements:
  - user-facing labels are friendly (`None`, `Low`, `Balanced`, `High`, `Max parallel`),
  - internal canonical values remain unchanged (`none|low|balanced|high|max_parallel`),
  - normalization accepts friendly aliases and hyphen/space variants.
- Prompt hardening updates:
  - prompts now explicitly state that swarm aggression controls subagent collaboration strategy, not raw scan aggressiveness.
  - plan prompts now explicitly forbid printing plain `plan_exit` text; it must be a tool call.
  - execution bootstrap reminder added after plan handoff to enforce todowrite + delegation lanes before deep scanning.
- TUI mode sync fix:
  - selected bottom agent now tracks latest effective user primary-agent transition, not only `plan_enter/plan_exit` tool-completion events.
  - helper added: `src/cli/cmd/tui/routes/session/agent-sync.ts`.

## Swarm Revision Phase 2.3 (2026-02-19, initial comms groundwork)
- Added cross-agent communication tool surfaces:
  - `team_inbox_read`: read team or per-session inbox with message-type filters
  - `team_inbox_ack`: explicit acknowledgement path tied to original message id
  - `team_broadcast`: fan-out messaging to all or selected teammate sessions
  - `team_wait`: polling wait primitive for coordination/synchronization points
- Enhanced message envelope metadata in `SwarmInbox.send()`:
  - `_meta.correlation_id`
  - `_meta.idempotency_key`
  - `_meta.priority` (`low|normal|high|critical`)
  - `_meta.ttl_seconds` and `_meta.expires_at`
  - `_meta.attempt`
- Inbox listing behavior now supports:
  - team-scoped filtering (always constrained by `team_id`),
  - optional per-session + broadcast inclusion,
  - type filters and `since`-time filtering,
  - TTL-aware suppression of expired messages.
- Added new message types:
  - `ack`
  - `announcement`
- Registry wiring updated to expose new tools by default.
- Tests extended:
  - `packages/opencode/test/tool/team-tools.test.ts` now validates read/ack/broadcast/wait flows.

## Pentest Plan Prompt Hardening (2026-03-05)
- Hardened plan-mode cyber prompt contract in:
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/prompt/plan.txt`
- Pentest planning is now explicitly execution-grade, not brainstorm-grade:
  - planner must front-load deeper read-only grounding before handoff,
  - final plan must be specific enough for another operator to execute with minimal improvisation,
  - plan must include explicit subagent use boundaries (`WILL use` vs `WILL NOT use`),
  - parent planner retains scope framing, sequencing, and cross-lane synthesis instead of delegating fuzzy shared-context work.
- Reporting closeout is now mandatory in the plan itself:
  - plan must end with `report_writer` invocation,
  - then creation of high-quality `report.html`,
  - then print-ready PDF generation from the HTML/CSS flow.
- Guided pentest kickoff text now reinforces the same contract before first plan-mode turn, so auto-routed pentest sessions start with a deeper planning posture immediately.

## Contracts + Gotchas
- Resolve git/repo root first to avoid nested path drift in this monorepo.
- Quote shell paths because local machine paths can include spaces.
- Keep `finding_json` HTML comment format parser-compatible for report generation.
- `build` alias is intentionally not treated as a cyber agent in env auto-scaffolding.
- Subagent `results.md` must end with:
  - `executed_commands`
  - `generated_files`
  - `unverified_claims`
  - `failed_commands`
- Skill reference discovery needs all `references/*.md` files enumerated, not sampled subsets.
- Runtime engagement artifacts under `packages/opencode/engagements/*` are local/runtime state and should stay ignored in git.
- History rewrite caution: running `git-filter-repo` across active branch history rewrites commit SHAs and can make fork divergence metrics explode (for example, thousands "ahead" with similar content). If cleanup is required, prefer path-scoped rewrites and then rebuild `dev` on top of `upstream/dev` with a squashed delta to restore sane ahead/behind counts.
- Branding gotcha (2026-02-10): keep external docs/service URLs on real OpenCode domains (for example `opencode.ai`, `api.opencode.ai`) unless DNS/domain ownership is confirmed. String-rebranding helpers should not rewrite domains by default.
- Prompt/runtime gotcha (2026-02-10): cyber environment details now flow through system context, while synthetic cyber reminders are intentionally sparse and reserved for late-stage gates.
- Opus 4.6 guardrail (2026-02-10): disable synthetic assistant reminder injection to satisfy strict Claude user-message sequencing behavior.
- TUI agent-switch gotcha (2026-02-26): in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`, do not couple agent auto-sync effects to `local.agent.current()` reads. That creates a feedback loop that immediately overwrites manual `tab agents` / command-palette changes in sessions with existing messages. Sync from message-derived signals only.

## Parallel Agent Branching Contract
- Multiple agents can safely run in parallel on this machine, but only with strict branch/worktree isolation.
- All feature implementation happens in the `opencode/` git repo root.
- Every agent session must create and stay on its own `codex/*` feature branch.
- Direct commits to `dev`/`main` are prohibited for agent work.
- Recommended setup: one git worktree per active agent branch (prevents shared working-tree collisions and accidental cross-agent staging).
- Mandatory pre-edit branch check:
  - `git rev-parse --abbrev-ref HEAD`
  - if current branch is `dev`/`main`, branch off immediately before touching files.
- Handoff contract per agent:
  - provide branch name,
  - latest commit SHA,
  - concise change summary + known risks/tests.
- Conflict hygiene:
  - never revert unrelated dirty files,
  - if unrelated changes appear, stop and report rather than "cleaning up".

## Maintenance Rules
- Update this file whenever:
  - we add/rename prompt-routing mappings,
  - scaffold contracts change,
  - reporting gates or quality modes change,
  - skill/reference discovery behavior changes,
  - any "tricky" behavior required for reliability is introduced,
  - branch/worktree coordination rules for multi-agent development change.

## Documentation Contract
- 2026-02-18: root `README.md` is now fork-specific and should stay ULMCode-first.
- Keep README positioning aligned with current product reality:
  - WIP but stable enough for real guided engagements,
  - default workflow centered on `plan` + `pentest` + `action`,
  - evidence/report artifact discipline is a core product contract, not optional docs flavor.

## Licensing Policy
- 2026-02-08: project license changed from MIT to `PolyForm Noncommercial 1.0.0`.
- Commercial use, resale, or offering paid services with this code now requires a separate written commercial license from Trevor Rosato (captured as `Required Notice:` lines in `LICENSE`).
- Keep package metadata (`package.json` license fields), user-facing license labels/links, and packaging metadata aligned with the root `LICENSE` to avoid mixed-license ambiguity.

## Upstream Sync Log
- 2026-03-02: merged latest `upstream/dev` into local `dev` and resolved 13 merge conflicts across workflow/config, TUI session routing, tool registry, and skill-discovery tests.
- 2026-03-02 sync gotchas:
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` now depends on `routes/session/agent-sync.ts`; keep both in sync during merges.
  - `PlanEnterTool` can be accidentally commented out during upstream merges in `packages/opencode/src/tool/plan.ts`; if that happens, `packages/opencode/test/tool/plan.test.ts` fails immediately.
  - Full `bun turbo typecheck` currently requires Bun `^1.3.10` per upstream script guard; local Bun `1.3.9` can still validate key packages with targeted `bun run --cwd packages/opencode typecheck` and `bun run --cwd packages/ui typecheck`.
- 2026-02-08: merged `upstream/dev` into fork branch `codex/upstream-sync-20260208` (17 upstream commits integrated at sync time).
- High-impact upstream areas landed:
  - prompt input UX and drag/drop attachment handling,
  - session side-panel + command handling tweaks,
  - terminal keybind focus behavior fixes,
  - web share-link handling and file path normalization tests,
  - i18n key updates across language packs.
- ULM custom cyber flow files in `packages/opencode/*` merged without conflicts in this sync.
- 2026-02-08 follow-up: fully untracked `packages/opencode/engagements/**` from git and enforced ignore-only runtime handling (keep only `.gitkeep` tracked).

## Daily Upstream Sync Automation Contract
- Goal: run a daily catch-up from `upstream/dev` into fork `dev` without losing ULM cyber custom behavior.
- Always sync in a branch named `codex/upstream-sync-<YYYYMMDD>`.
- Required sequence:
  1) `git checkout dev && git pull origin dev`
  2) `git fetch upstream --prune`
  3) create sync branch from current `dev`
  4) `git merge --no-ff upstream/dev`
  5) resolve conflicts using precedence rules below
  6) run validation (`bun turbo typecheck` at minimum)
  7) push branch and open PR into `dev`

### Conflict Handling Rules
- Treat `packages/opencode/**` as ULM-critical surface:
  - preserve ULM-specific cyber orchestration behavior by default,
  - adopt upstream fixes when they do not change ULM contracts.
- For prompt and routing files, never silently drop ULM mappings:
  - `packages/opencode/src/session/prompt/cyber-core.txt`
  - `packages/opencode/src/agent/prompt/pentest.txt`
  - `packages/opencode/src/agent/prompt/pentest-auto.txt`
- For engagement runtime artifacts:
  - keep `packages/opencode/engagements/**` ignored and untracked (except `.gitkeep`),
  - do not reintroduce tracked engagement outputs during conflict resolution.
- If conflict touches both security-critical behavior and upstream runtime assumptions, prefer explicit manual reconciliation and document the decision in PR notes.

## Security Incident Notes
- 2026-02-10: confirmed sensitive engagement outputs were historically committed under:
  - `packages/opencode/finding.md`
  - `packages/opencode/.engagements_link_backup`
  - `packages/opencode/.opencode/engagements/**`
  - `packages/opencode/.opencode/engagements_legacy_backup/**`
- Required remediation now includes:
  1) keep these paths ignored in root `.gitignore`,
  2) keep all engagement runtime artifacts local-only and untracked,
  3) if any of these paths appear in git history, perform history rewrite + force-push cleanup to `origin/dev` and `origin/main`.

## Agent Surface Simplification (2026-02-10)
- Primary agent UX now targets three clear roles: `plan` (read-only planning), `pentest` (guided cyber orchestrator), and `action` (general one-off operator mode).
- `pentest` is the canonical default behavior when `default_agent` is unset.
- Legacy IDs remain for compatibility but should be treated as aliases:
  - `AutoPentest`, `pentest_flow`, `pentest_auto` -> `pentest`
  - `build` -> `action`
- Workspace custom docs agent at `.opencode/agent/docs.md` was removed to reduce selector clutter and avoid non-cyber mode confusion.
- TUI plan handoff should return to the last active visible primary agent after `plan_exit` rather than forcing hidden aliases.

### Required PR Format For Syncs
- Title: `chore(sync): merge upstream dev into fork (<YYYY-MM-DD>)`
- Base/head: `dev <- codex/upstream-sync-<YYYYMMDD>`
- PR body must include:
  - upstream behind/ahead counts at sync start,
  - high-impact areas changed upstream,
  - files/areas where ULM logic was intentionally preserved,
  - validation commands run + pass/fail,
  - explicit callout of unresolved risk or follow-up tasks (if any).

### Bot Review + Checks Wait Strategy
- Use an `up to 8 minutes` wait window for post-PR review triage.
- Poll PR status every 60 seconds during that window.
- Exit early as soon as both conditions are true:
  - all required checks are complete (pass/fail), and
  - bot/human reviews/comments for the latest commit are visible.
- Do not do a blind fixed sleep before triage.
- If checks are still pending/queued after 8 minutes, continue with a slower poll loop (every 2-3 minutes) and classify the run as `blocked` only when there is a durable external blocker (for example: stuck queue, permission issue, or unavailable runners).

## Defensive Expansion Notes (2026-02-10)
- Added defensive finding metadata support in `packages/opencode/src/tool/finding.ts` and `packages/opencode/src/report/report.ts`:
  - `finding_type`, `control_refs`, `baseline_state`, `expected_state`, `positive_finding`
- Added quality warning hooks for defensive report integrity:
  - `missing_control_refs` for compliance/policy findings without mappings
  - `missing_baseline_delta` for hardening recommendations without current/expected states
- Added standalone defensive tools (manual + file-ingest, API-adapter-ready contracts):
  - `baseline_check`, `compliance_mapper`, `alert_analyzer`, `detection_validator`, `ir_timeline_builder`
- Added defensive skill pack source at `tools/ulmcode-profile/skills/defensive-compact/*` with compact SKILL.md + references model.
- Updated profile bootstrap script to optionally include defensive skill pack by default (`WITH_DEFENSIVE=1`) while preserving strict deny-by-default skill permissions.

## Defensive Tool Exposure Note (2026-02-10)
- Defensive tools currently exist in source (`baseline_check`, `compliance_mapper`, `alert_analyzer`, `detection_validator`, `ir_timeline_builder`) but are intentionally not registered in `packages/opencode/src/tool/registry.ts`.
- Rationale: keep pentest-focused model behavior clean and avoid tool-selection confusion during core offensive workflows.
- Re-enable later by re-adding these tools to `ToolRegistry.all()` once dedicated defensive mode/routing is in place.

## Upstream General Instructions
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

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

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
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## ULMcode Hotfix Notes

- V2.1.1 regression fix: TUI agent sync must use newest user message by timestamp/id, not array order. The message array is not guaranteed chronological, and naive `findLast()` can snap plan sessions back to pentest.
- Keep explicit approval gating for `plan_exit` when handing off to `pentest`; this prevents accidental immediate execution and plain-text `plan_exit` dead ends.
- V2.1.1 follow-up: first-message pentest kickoff must be routed at message creation time (`SessionPrompt.createUserMessage`) to agent `plan`, not via loop-time synthetic kickoff. This keeps UI mode and execution mode aligned and prevents immediate snapback into pentest behavior.
- V2.1.1 follow-up 2: first-message pentest reroute must also inject kickoff guidance + force-create cyber environment at ingestion (`SessionPrompt.prompt`) or plan mode falls back to generic read-only coding behavior and skips expected safe recon snapshot steps.
- GPT-5.4 support hotfix (2026-03-05): OpenAI family handling was mostly already generic, but two manual paths needed intervention:
  - `packages/opencode/src/plugin/codex.ts` had a stale OAuth allowlist/manual model injection path that would hide brand-new OpenAI models until explicitly added.
  - `packages/opencode/src/provider/provider.ts` now supplements `gpt-5.4` and `gpt-5.4-pro` for the plain OpenAI provider so releases are not blocked on `models.dev` catalog lag.
- Reasoning variants gotcha: `ProviderTransform.variants()` does not treat versioned GPT-5 models as supporting `minimal` by default unless the model id matches the legacy `gpt-5` / `gpt-5-*` pattern. Do not assume `gpt-5.4` or `gpt-5.4-pro` will expose `minimal` unless that logic is intentionally broadened.
