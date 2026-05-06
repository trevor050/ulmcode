---
name: k12-incident-response
description: Use for rapid incident triage, evidence preservation, and timeline reconstruction during high-pressure response events.
---

# K-12 Incident Response

## Objective
Move quickly without losing evidence quality or reporting discipline.

## Workflow
1. classify incident severity and immediate containment needs.
2. collect immutable evidence and preserve chain-of-custody metadata.
3. build a normalized timeline from multi-source artifacts.
4. identify affected systems/accounts and probable entry path.
5. publish actionable containment and recovery next actions.

## Guardrails
- default to non-destructive evidence collection.
- record unknowns explicitly during live response.
- keep operator actions time-stamped for post-incident review.

## Required Artifacts
- incident timeline output.
- affected asset/account inventory.
- containment + recovery checklist with owners.

## Deep-Dive References
- `references/ir-playbook.md`
- `references/forensic-artifact-locations.md`
- `references/chain-of-custody.md`

## Durable ULM Tools
- Use `operation_status` to read the operation ledger before analysis.
- Use `evidence_record` for source artifacts and `finding_record` for validated security claims.
- Use `runtime_summary` for handoff context when work spans sessions.
