# Decision: Evidence, Finding, And Report Factory

## What Was Researched

- Professional pentest automation succeeds or fails on evidence quality and reviewer traceability, not just finding volume.
- PentestGPT-style loops still need parsing and evidence retention so the reasoning layer does not turn observations into unsupported certainty.
- Long reports need section budgets and review gates, otherwise autonomous writers produce thin deliverables.
- Nmap's own documentation recommends XML for programs instead of parsing normal output, ProjectDiscovery httpx supports JSONL output, ffuf supports JSON/jsonlines automation output, and ZAP baseline can emit JSON. ULMCode should prefer those structured outputs and only fall back to text notes when no parser exists.

## Adopted

- `evidence_record` writes durable evidence JSON and optional raw files.
- `evidence_normalize` converts supervised command artifacts into `evidence-index.json`, `leads.json`, and citable evidence records. It now parses HTTP JSONL, DNS JSONL, Nmap XML, ffuf JSON, ZAP JSON, screenshot manifests, TLS JSONL, and cloud/SaaS/auth asset JSON.
- `operation_queue` keeps unverified leads useful by turning them into scoped command work units instead of prematurely promoting them to findings. Queue units carry a stable `workUnitID` through `command_supervise`, letting `operation_run` mark follow-up probes complete or failed from background job state.
- `FINAL_PACKAGE_FILES` defines the exact handoff bundle: `report.pdf`, `report.html`, `findings.json`, `evidence-index.json`, `operator-review.md`, `executive-summary.md`, `technical-appendix.md`, `runtime-summary.md`, and `manifest.json`.
- `finding_record` distinguishes candidate, validated, rejected, and report-ready findings and enforces evidence for validated/report-ready states.
- `report_outline` creates page and section budgets before drafting.
- `report_lint` catches sparse reports, missing outline sections, unsupported findings, unresolved candidates, missing final artifacts, missing runtime summaries, corrupt final package files, stale copied runtime summaries, and manifest paths that no longer match the rendered handoff bundle.
- `report_render` publishes final HTML, PDF, README, manifest, evidence index, and reportability counts.
- `runtime_summary` and `operation_audit` are mandatory closeout artifacts for long operations.

## Rejected

- Chat-only evidence. It cannot be reliably cited or reviewed after compaction.
- One-pass final report generation. It is too easy to miss finding sections, methodology, or runtime limitations.
- Treating unverified leads as findings. Leads are useful, but report-ready claims require validation and evidence references.
- Parsing human terminal text as if it were authoritative structure. Structured outputs are preferred; text fallback is intentionally low-confidence.

## Implementation Anchors

- `packages/opencode/src/tool/evidence_record.ts`
- `packages/opencode/src/tool/evidence_normalize.ts`
- `packages/opencode/src/ulm/evidence-normalizer.ts`
- `packages/opencode/test/ulm/evidence-normalizer.test.ts`
- `packages/opencode/src/tool/finding_record.ts`
- `packages/opencode/src/tool/report_outline.ts`
- `packages/opencode/src/tool/report_lint.ts`
- `packages/opencode/src/tool/report_render.ts`
- `packages/opencode/src/tool/runtime_summary.ts`
- `tools/ulmcode-profile/skills/pentest-compact/k12-long-report-production/SKILL.md`
