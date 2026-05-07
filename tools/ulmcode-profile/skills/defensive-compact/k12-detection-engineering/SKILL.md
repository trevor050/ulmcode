---
name: k12-detection-engineering
description: Use for assessing SOC detection coverage against likely attacker behavior, reducing alert noise, and producing focused tuning recommendations.
---

# K-12 Detection Engineering

## Objective
Measure detection coverage quality and identify practical SOC tuning opportunities.

## Workflow
1. ingest alert exports and detection rule inventory.
2. map detections to technique coverage.
3. classify blind spots and false-positive clusters.
4. prioritize improvements by risk and operational impact.
5. output a concise rule-tuning backlog.

## Guardrails
- avoid broad tuning advice without alert evidence.
- preserve high-signal detections while reducing noise.
- tag recommendations that require platform-specific API validation later.

## Required Artifacts
- detection coverage summary.
- top noisy sources + probable false positives.
- prioritized detection gap list.

## Deep-Dive References
- `references/detection-coverage-matrix.md`
- `references/alert-triage-playbook.md`
- `references/log-source-checklist.md`

## Durable ULM Tools
- Use `operation_status` to read the operation ledger before analysis.
- Use `evidence_record` for source artifacts and `finding_record` for validated security claims.
- Use `runtime_summary` for handoff context when work spans sessions.
