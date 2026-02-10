---
name: k12-hardening-baseline
description: Run evidence-first baseline hardening reviews for district infrastructure, identify configuration drift, and package prioritized remediation with clear ownership.
---

# K-12 Hardening Baseline

## Objective
Validate current defensive posture against baseline controls and produce remediation-ready outputs.

## Workflow
1. Confirm scope and approved validation depth.
2. Collect baseline observations from command output or config exports.
3. Compare observed vs expected control state.
4. Log findings with `finding_type=hardening_recommendation`.
5. Prioritize remediation and preserve positive controls.

## Guardrails
- default to read-only verification.
- do not change production configuration without explicit approval.
- avoid assumptions when baseline evidence is incomplete.

## Required Artifacts
- `finding.md` entries for each material gap.
- `reports/remediation-plan.md` with 30/60/90 sequencing.
- `reports/quality-checks.json` with evidence-link integrity.

## Deep-Dive References
- `references/windows-cis-checklist.md`
- `references/linux-cis-checklist.md`
- `references/mfa-audit-checklist.md`
