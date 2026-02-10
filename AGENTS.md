# ULMcode Agents Notes

Last updated: 2026-02-10

## Project Summary
- Repo root: `opencode/` (fork of OpenCode).
- Primary customization area: `packages/opencode` (ULM cybersecurity harness + orchestration behavior).
- Product intent: evidence-first, non-destructive-by-default internal pentest orchestration with guided operator flow.

## Key Architecture
- `packages/opencode`: core runtime, session orchestration, tool routing, reporting, cyber agent behavior.
- `packages/app`: web UI.
- `packages/desktop`: desktop app shell.
- `tools/ulmcode-profile`: skill profile + bootstrap sync scripts used by runtime harness.

## Current Behavior Snapshot
- `pentest` is the default guided mode when no explicit agent is set.
- Guided flow is plan-first and requires explicit confirmation before execution handoff (`plan_exit`).
- Engagement scaffold must maintain required artifacts (`finding.md`, `handoff.md`, `engagement.md`, evidence folders, agent results, reports).
- Reporting flow is enforced; `report_writer` must run before finalization.

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

## Licensing Policy
- 2026-02-08: project license changed from MIT to `PolyForm Noncommercial 1.0.0`.
- Commercial use, resale, or offering paid services with this code now requires a separate written commercial license from Trevor Rosato (captured as `Required Notice:` lines in `LICENSE`).
- Keep package metadata (`package.json` license fields), user-facing license labels/links, and packaging metadata aligned with the root `LICENSE` to avoid mixed-license ambiguity.

## Upstream Sync Log
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
- Do not use a blind fixed sleep before triage.
- Start polling PR state immediately after creating/updating the `dev -> main` PR.
- Poll interval: every 60 seconds.
- Exit early from polling as soon as:
  - all required checks are complete (pass/fail), and
  - bot/human reviews/comments for the latest commit are visible.
- Keep 8 minutes as a max wait ceiling, not a mandatory delay.
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
