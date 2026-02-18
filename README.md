# ULMCode

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

This is still WIP, but the core workflow is already solid: plan -> execute -> document -> ship report.

## What This Fork Is

- Evidence-first pentest orchestration, not just a generic coding agent.
- Non-destructive by default unless explicitly authorized otherwise.
- Guided operator flow with explicit handoff from planning to execution.
- Structured engagement artifacts so results are reproducible and reviewable.

## Current Core Flow

1. Start in planning/guided intake mode.
2. Confirm scope, authorization, constraints, and objectives.
3. Approve handoff into execution (`plan_exit`).
4. Execute and continuously log findings/evidence.
5. Run `report_writer` for final synthesis and report packaging.

## Agents

Primary agent UX in this fork:

- `plan`: read-only planning and analysis.
- `pentest`: primary guided cyber orchestrator (default behavior).
- `action`: one-off operator mode when you do not want full guided flow.

Compatibility aliases still exist for older sessions (`AutoPentest`, `pentest_flow`, `pentest_auto`) and map back to `pentest`.

## Engagement Artifacts

Cyber sessions scaffold and maintain shared artifacts including:

- `finding.md`
- `engagement.md`
- `handoff.md`
- `engagements/<id>/evidence/*`
- `engagements/<id>/reports/*`
- `engagements/<id>/agents/*/results.md`

The reporting pipeline expects those artifacts to stay consistent.

## Install

### macOS/Linux

```bash
curl -fsSL https://raw.githubusercontent.com/trevor050/ulmcode/main/install | bash
```

### Windows (PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/trevor050/ulmcode/main/install.ps1 | iex
```

### Desktop App (BETA)

## Local Development

From repo root (`opencode/`):

```bash
bun install
bun dev
```

Useful variants:

```bash
bun dev:web       # app frontend
bun dev:desktop   # desktop shell
bun typecheck
```

## Repo Layout

- `packages/opencode`: core runtime, orchestration, agent/tool routing, reporting.
- `packages/app`: web UI client.
- `packages/desktop`: desktop client.
- `tools/ulmcode-profile`: isolated profile + skills bootstrap for ULM runtime.

## Notes For Contributors

- Workspace container is `ULMcode/`, git repo root is `ULMcode/opencode/`.
- Runtime engagement outputs are local state and should stay untracked.
- Prefer preserving ULM-specific cyber contracts when syncing upstream changes.

## Upstream Credit

This project is built on top of [OpenCode](https://github.com/anomalyco/opencode).
ULMCode intentionally diverges in agent behavior, workflow constraints, and reporting contracts to support internal pentest operations.

## License

PolyForm Noncommercial 1.0.0. See `LICENSE`.
