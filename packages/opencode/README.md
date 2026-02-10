# ULMCode (`packages/opencode`)

Core runtime for the ULM pentest harness: agent orchestration, engagement scaffolding, finding lifecycle, and report bundling.

## Local Development

```bash
bun install
bun test
```

## Report Quality Modes

`report_finalize` now bundles quality telemetry in `reports/quality-checks.json` and exposes quality status in tool output.

Configure in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "cyber": {
    "report_quality_mode": "warn"
  }
}
```

Supported modes:
- `warn` (default): publish report artifacts and surface quality warnings in `report.md`, `results.md`, and `report_finalize` output.
- `strict`: fail finalization if quality gates fail (missing/empty evidence links, weak claim validation, or critical quality errors).

## How to Interpret Quality Output

Read `reports/quality-checks.json`:
- `evidence_link_score`: ratio of non-empty evidence references to total references.
- `claim_validation_score`: ratio of claims validated against referenced evidence content.
- `empty_artifact_count`: referenced files that exist but are empty.
- `warning_count`: total quality warnings.
- `quality_status`: `pass`, `warn`, or `fail`.

The report now includes:
- `Quality Warnings`
- `Known Unknowns`
- `Unverified Claims`
- `Source Traceability` table (finding-by-finding evidence linkage)

## Subagent Completion Contract

Cyber subagents must end `agents/<session>/results.md` with:
- `executed_commands`
- `generated_files`
- `unverified_claims`
- `failed_commands`

For `assess` outputs, findings must be classified as `validated` vs `hypothesis`. High confidence is reserved for validated findings.
