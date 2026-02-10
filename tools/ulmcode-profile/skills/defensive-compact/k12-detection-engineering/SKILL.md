---
name: k12-detection-engineering
description: Assess SOC detection coverage against likely attacker behavior, reduce alert noise, and produce focused tuning recommendations.
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
