# ULMcode

ULMcode is an OpenCode fork focused on internal, authorized cybersecurity operations.

It keeps the OpenCode multi-client agent platform (CLI/TUI, web, desktop, API), then adds a hardened pentest harness built for evidence quality, reproducibility, and report-grade outputs.

## What this project is for
- Running guided internal security assessments with AI-assisted orchestration
- Standardizing engagement artifacts across analysts and subagents
- Producing client-ready reports with traceability and quality gates
- Reducing overclaiming and weak-evidence findings in final deliverables

## Core concept: AutoPentest
`AutoPentest` is the default orchestrator mode in this fork.

It is designed to:
- collect essential intake details first (scope, authorization, constraints, depth)
- force plan-first execution with explicit operator confirmation
- delegate independent workstreams to specialized cyber subagents
- maintain a canonical `finding.md` as the source of truth
- enforce final `report_writer` completion before engagement close

## Cyber harness features
- Shared engagement workspace scaffolded under:
  - `engagements/<date>-<session>/`
- Structured artifacts:
  - `finding.md`, `handoff.md`, `engagement.md`
  - `evidence/raw`, `evidence/processed`
  - `agents/<subagent-session>/results.md`
  - `reports/*`
- Structured finding payloads embedded as `finding_json` comments for deterministic parsing
- Runtime reminders and fallback automations for plan/report workflow integrity

## Reporting and quality system
ULMcode includes a report validation/bundling pipeline via `report_finalize`.

Outputs include:
- `report.md`, `report.pdf`
- `findings.json`, `sources.json`, `timeline.json`, `run-metadata.json`
- `quality-checks.json`

Quality gates support:
- `warn` mode (default): finalize with warnings surfaced
- `strict` mode: fail finalize on quality threshold failures

Config example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "cyber": {
    "report_quality_mode": "warn"
  }
}
```

## Project layout
- `packages/opencode`: core runtime + cyber harness
- `packages/app`: web app
- `packages/desktop`: desktop app
- `packages/web`: docs/site content
- `packages/enterprise`: enterprise-facing web/server layer
- other `packages/*`: SDKs, plugins, integrations, utilities

## Local development

```bash
bun install
bun run dev
```

Useful scripts:

```bash
bun run dev          # runtime (packages/opencode)
bun run dev:web      # web app
bun run dev:desktop  # desktop app
```

## Important safety notes
- This harness assumes authorized internal security testing only.
- Non-destructive testing is the default posture.
- Destructive/disruptive actions require explicit authorization.

## Attribution
ULMcode is built as a fork of [OpenCode](https://github.com/anomalyco/opencode), extended for cyber engagement workflows.
