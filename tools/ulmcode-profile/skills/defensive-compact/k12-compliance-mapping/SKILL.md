---
name: k12-compliance-mapping
description: Use for mapping security findings to FERPA/CIS/NIST-style controls, surfacing coverage gaps, and producing audit-ready evidence traces.
---

# K-12 Compliance Mapping

## Objective
Translate findings into framework-aligned control status with linked evidence.

## Workflow
1. Normalize findings and deduplicate overlapping issues.
2. Map each finding to framework control IDs.
3. Flag unmapped findings as documentation debt.
4. Validate evidence links for every mapped control.
5. Publish compliance summary and remediation ownership.

## Guardrails
- never mark a control as pass without evidence.
- track exemptions explicitly with rationale.
- separate validated controls from hypotheses.

## Required Artifacts
- control coverage table in report output.
- unmapped finding list with required follow-up.
- explicit high-risk compliance gaps and due dates.

## Deep-Dive References
- `references/ferpa-control-map.md`
- `references/cis-control-map.md`
- `references/audit-evidence-requirements.md`

## Durable ULM Tools
- Use `operation_status` to read the operation ledger before analysis.
- Use `evidence_record` for source artifacts and `finding_record` for validated security claims.
- Use `runtime_summary` for handoff context when work spans sessions.
