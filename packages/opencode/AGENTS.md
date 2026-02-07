# ULMCode Agent Notes (packages/opencode)

Last updated: 2026-02-07

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
- Primary orchestration agent: `pentest`.
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
