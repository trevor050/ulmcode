# ULMCode Agent Notes (packages/opencode)

Last updated: 2026-02-07 (plan-flow fallback + quality-gate rollout)

## Project Snapshot
- ULMCode is an OpenCode fork focused on internal, authorized penetration testing workflows.
- This package (`packages/opencode`) contains the core runtime, agent orchestration, tool registry, and report generation pipeline.
- The cyber workflow is not just prompt-level, it is enforced in runtime logic.

## Branch + Release Context
- Primary upstream default branch is `dev`.
- Current ULM snapshot commit lineage includes:
  - `2258ab1bd` (`feat: complete cyber harness runtime, subagents, and report bundle`)
  - `775a6f410` (`chore(ulmcode): snapshot pentest harness state`)
- Sync commit used to align fork branches: `b517b9b15` (merged ULM snapshot onto latest `trevor/dev`).

## Cyber Harness Architecture
- Core cyber agent definitions live in `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/src/agent/agent.ts`.
- Primary orchestration agents: `pentest` and guided `AutoPentest`.
- Specialized subagents: `recon`, `assess`, `report`, `network_mapper`, `host_auditor`, `vuln_researcher`, `evidence_scribe`, `report_writer`.
- Compatibility alias: `analyst` maps to assess behavior.

## Shared Engagement Environment
- Environment logic: `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/src/session/environment.ts`.
- Cyber sessions scaffold into: `engagements/<date>-<session-short>/`
- Required shared artifacts:
  - `finding.md`
  - `engagement.md`
  - `handoff.md`
  - `agents/<subagent-session-id>/results.md`
  - `reports/`
  - `evidence/raw`, `evidence/processed`
- Legacy path migration is handled: `.opencode/engagements` -> `engagements` with symlink compatibility.
- `engagements/latest` symlink is maintained.

## Finding Lifecycle
- Finding tool: `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/src/tool/finding.ts`.
- `finding` writes to environment-root `finding.md` when cyber environment exists, otherwise falls back to project-level `finding.md`.
- Findings include machine-parsable HTML comments (`<!-- finding_json:{...} -->`) that power downstream report generation.
- Findings now support optional `evidence_refs` (`path` + optional `line_hint`) for deterministic evidence-link validation during report bundling.

## Report Workflow (Hard Requirements)
- Report writer prompt: `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/src/agent/prompt/report-writer.txt`.
- Finalization tool: `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/src/tool/report_finalize.ts`.
- Report bundle generator: `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/src/report/report.ts`.
- Required intermediate markdown outputs in `reports/`:
  - `report-plan.md`
  - `report-outline.md`
  - `report-draft.md`
  - `results.md`
  - `remediation-plan.md`
- Required structured outputs:
  - `findings.json`
  - `sources.json`
  - `timeline.json`
  - `run-metadata.json`
  - `report.md`
  - `report.pdf` (unless explicitly degraded outside `report_writer`)

## Reporting/PDF Implementation Notes (Critical)
- `report_finalize` previously overwrote authored report artifacts with generated defaults; this now preserves existing non-empty `reports/report.md`, `reports/report-draft.md`, `reports/remediation-plan.md`, `reports/report-plan.md`, `reports/report-outline.md`, and `reports/results.md`.
- The final PDF renderer is `/Users/trevorrosato/codeprojects/ULMcode/opencode/packages/opencode/src/report/pdf/generate_report_pdf.py`.
- PDF rendering was upgraded from raw markdown `Preformatted` dump to styled layout parsing (headings, lists, code blocks, severity emphasis, cover page, page chrome).
- PDF renderer now includes executive snapshot cards, table of contents, and findings matrix extraction for client-facing readability.
- `report_writer` prompt now explicitly requires assembling polished `reports/report.md` before `report_finalize`, so authored client copy is retained and used for PDF output.
- Contract update: `report_finalize` is now validation/bundling-first and requires model-authored report artifacts when invoked from reporting flow; it does not auto-generate report templates/PDF in that mode.
- HTML-first contract: report runs should author `reports/report-render-plan.md`, `reports/report.html`, and `reports/report.pdf`; browser print-to-PDF is preferred over Python canvas pipelines.
- Smoke-test efficiency: report_writer prompt now enforces concise artifact limits to reduce token/compute overhead during quick verification runs.
- Quality telemetry is now emitted to `reports/quality-checks.json` and surfaced by `report_finalize`.
- Config toggle: `cyber.report_quality_mode = "warn" | "strict"` (default `warn`).
  - `warn`: do not block finalization, but emit warning banner + quality summary.
  - `strict`: fail finalization on poor evidence linkage or critical quality errors.
- Report rendering now includes:
  - Quality warnings banner
  - Known Unknowns
  - Unverified Claims
  - Source Traceability table with per-finding validation status and evidence files.
- Confidence now has an adjusted quality-aware value (downgraded when evidence linkage is weak or claims are unverified).

## Transcript-Learned Pitfalls (2026-02-07 smoke test)
- Common failure mode: subagents may read repo files from a wrong nested root (for example `packages/opencode/.github/...` instead of `<repo>/.github/...`).
  - Prompts now instruct resolving repo root early via `git rev-parse --show-toplevel` and using root-anchored absolute paths.
- `report_finalize` can be invoked from child `report_writer` sessions; report metadata must still represent the top-level engagement session.
  - `ReportBundle.generate` now resolves and uses the root parent session for session/timeline metadata.
- Subagents previously had blanket `edit: deny`, which blocked updates to required engagement artifacts (`handoff.md`, `agents/*/results.md`, `reports/*`).
  - Cyber subagents now use scoped edit permissions: deny by default, allow only those engagement artifact paths.
- Overclaiming pitfall: polished report copy can claim completion while unresolved findings remain.
  - Runtime now emits contradiction warnings (example: “no remaining next steps” while actionable findings exist).
- Confidence-theater pitfall: high confidence attached to weakly evidenced claims.
  - Quality checks now validate referenced evidence files + claim tokens (ports/versions) and downgrade adjusted confidence as needed.

## Enforcement Chain (Important)
- Cyber reminder injection is in `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/src/session/prompt.ts`.
- Enforcement layers:
  1. Prompt-level requirement in `pentest` and `report_writer` prompts.
  2. Synthetic reminder markers (skill loading, report_writer required).
  3. Auto-launch fallback: if pentest has completed cyber subtasks and no `report_writer` run, runtime queues `task(subagent_type="report_writer")`.
- Marker constants (used by tests, do not casually rename):
  - `[CYBER_SKILL_REMINDER_V1]`
  - `[CYBER_REPORT_WRITER_REQUIRED_V1]`
  - `[REPORT_WRITER_SKILL_REQUIRED_V1]`
- Plan-mode resilience note:
  - If a plan-mode cyber assistant prints literal `plan_exit` text instead of calling the `plan_exit` tool, runtime now catches that and triggers the same approval question UI automatically.
  - This fallback now applies in generic plan sessions too, not only cyber-tagged sessions.
  - On approval, runtime enqueues a synthetic user message and maps `AutoPentest`/`pentest_flow`/`pentest_auto` back to `pentest` execution mode.
  - On rejection, runtime keeps the session in `plan` and requests plan refinement instead of dead-ending.

## Path + Shell Gotcha
- Host paths include spaces (`Mobile Documents/...`).
- Runtime reminders explicitly tell agents to quote absolute paths.
- Keep this behavior, otherwise shell commands break in real runs.

## Isolated Profile Tooling
- Profile bootstrap + isolation checks:
  - `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/tools/ulmcode-profile/scripts/bootstrap-ulmcode-profile.sh`
  - `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/tools/ulmcode-profile/scripts/check-ulmcode-skill-isolation.sh`
- Profile enforces deny-by-default skill permissions and allowlists compact K-12 pentest skills.
- Launcher exports strict runtime vars:
  - `OPENCODE_CONFIG_DIR`
  - `OPENCODE_CONFIG`
  - `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`
  - `OPENCODE_DISABLE_PROJECT_CONFIG=1`

## Test Anchors For This Harness
- Environment scaffolding + legacy normalization:
  - `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/test/session/environment.test.ts`
- Reminder/enforcement behavior:
  - `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/test/session/prompt-cyber-reminder.test.ts`
  - `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/test/session/prompt-report-writer-enforcement.test.ts`
  - `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/test/session/report-writer-skill-autoload.test.ts`
- Finding/report outputs:
  - `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/test/tool/finding-environment.test.ts`
  - `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/test/tool/report-finalize.test.ts`
  - `/Users/trevorrosato/Library/Mobile Documents/com~apple~CloudDocs/slatt/codeprojects/ULMcode/opencode/packages/opencode/test/report/report-bundle-extended.test.ts`

## Practical Rules For Future Agents
- Keep the report_writer terminal stage intact, do not remove fallback auto-queue behavior without replacing equivalent guarantees.
- Preserve the `finding_json` embedded format or update parser + tests together.
- Preserve environment root migration behavior for legacy `.opencode/engagements` installs.
- If changing model/system prompt routing, keep `SystemPrompt.withCyber(...)` behavior so cyber-core policy still appends across providers.
- Do not present “complete/closed/no remaining next steps” language unless findings + quality checks support that claim.
- Always include structured subagent completion fields in `results.md`:
  - `executed_commands`, `generated_files`, `unverified_claims`, `failed_commands`.
