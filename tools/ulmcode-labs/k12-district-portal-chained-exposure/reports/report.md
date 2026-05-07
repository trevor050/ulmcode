# Authored District Portal Assessment

district-authored-report-marker

## Executive Summary

This authored lab report verifies that ULMCode preserves a report writer's drafted narrative instead of replacing it with a generated fallback during final rendering. The synthetic district portal assessment produced two report-ready findings: administrator MFA was optional, and a student export endpoint returned sensitive fields across district tenant boundaries. Cross-district student export is the highest-priority risk because it combines privileged account compromise with bulk student data exposure. The MFA gap increases the likelihood of that path, while the audit gap reduces the district's ability to detect or reconstruct the event quickly.

## Scope, Authorization, and Methodology

The scope was limited to the bundled synthetic K-12 district portal lab. No real school system, SIS, guardian record, or student account was contacted. The methodology used recorded HTTP-style evidence artifacts, an explicit operation plan, validated finding records, and final handoff gates. The replay modeled an authorized internal assessment where the operator first reviewed authentication policy, then confirmed administrator login behavior, then exercised the student export workflow with tenant-boundary observations. Each claim in this report maps back to stored evidence IDs in the operation folder, and the lab deliberately keeps the data fictional.

## Environment Overview

The target represents a district administration portal with administrator session policy endpoints, login behavior, student export controls, and export audit events. The synthetic policy marks administrator MFA as optional and does not require step-up authentication before exports. The export policy allows an `include=all` request and reports tenant filtering as disabled. The audit event stream records a sensitive export as an ordinary report view, which creates a detection and incident-response weakness beyond the access-control problem itself.

## Attack Path Narrative

The plausible path begins with a district administrator password being compromised through phishing, reuse, or helpdesk reset abuse. Because MFA is optional, the attacker can authenticate without a second factor and establish a privileged district-admin session. That session can then call the export endpoint with broad inclusion flags and receive records from more than one district tenant, including sensitive fields such as support flags, guardian contact data, and discipline notes. The audit trail does not raise the event as an elevated sensitive export, so follow-up detection depends on manual log review rather than a targeted alert.

## Findings Detail

The first finding is that district administrator login does not require MFA. Evidence `ev-district-session-policy` shows administrator MFA is optional and export step-up is disabled. Evidence `ev-district-admin-login` shows a district administrator session was created without an MFA challenge. The impact is high because administrator sessions can reach student data and operational workflows. Remediation should require phishing-resistant MFA for all administrators, enforce step-up authentication before sensitive exports, and alert on privileged logins missing MFA context.

The second finding is that student export returns sensitive fields across district tenants. Evidence `ev-student-export-policy` shows broad export options and disabled tenant filtering. Evidence `ev-cross-district-export` shows multiple district tenants and sensitive fields in a single response. Evidence `ev-export-audit-gap` shows the event was not logged as elevated. The impact is critical because a compromised or overprivileged session could export sensitive student data outside the intended district boundary. Remediation should enforce server-side tenant scoping, restrict sensitive fields by purpose and role, require approval or step-up for bulk exports, and emit elevated audit events.

## Risk Register and Prioritized Roadmap

Priority one is tenant scoping on the export API, because that directly limits blast radius and prevents cross-district disclosure. Priority two is mandatory administrator MFA with export step-up, because it reduces the likelihood of a stolen password reaching sensitive workflows. Priority three is elevated export audit logging with alerting, because the district needs fast detection and reliable incident reconstruction. These changes should be validated with regression tests that prove an administrator from one district cannot export another district's students, sensitive fields require explicit authorization, and all bulk exports create high-signal audit events.

## Coverage, Browser Evidence, and Testing Limits

Coverage was limited to the synthetic district portal API surfaces represented in the replay: administrator session policy, administrator login, student export policy, cross-district export response, and export audit events. The lab uses recorded HTTP evidence rather than live browser screenshots, so browser evidence is intentionally absent and should not be interpreted as proof that the real portal UI exposes or hides these workflows. Testing did not contact production systems, real identity providers, real student records, or district SIEM tooling. The useful confidence comes from the server-side evidence chain and the report-ready finding records, while UI workflow behavior remains a follow-up validation item for a real authorized assessment.

## Validation Limits and Known Unknowns

This report is based on a synthetic replay and does not measure production exploitability, live identity-provider policy, real tenant data shape, or actual district logging pipelines. The lab does not attempt persistence, privilege escalation beyond the district-admin role, or destructive data changes. Those limits are intentional. A real assessment would add identity-provider configuration review, production-safe export authorization tests, alert delivery verification, and stakeholder confirmation that remediation sequencing matches district operational constraints.

## Evidence Map

The MFA finding cites `ev-district-session-policy` and `ev-district-admin-login`. The cross-district export finding cites `ev-student-export-policy`, `ev-cross-district-export`, and `ev-export-audit-gap`. The evidence map is intentionally short because this lab is designed to test report preservation and multi-finding handoff behavior, not to simulate a large engagement evidence archive. The important validation point is that authored prose, finding references, and risk sequencing survive `report_render` into both final HTML and PDF artifacts.

## Operator Handoff Checklist

- Review the two report-ready findings and confirm their evidence IDs are present in the final manifest before sharing the report.
- Treat the authored-report marker as an automation check only; remove it before any client-style deliverable leaves the lab context.
- Confirm `runtime-summary.json`, `operation-audit.json`, validation stage gate output, final HTML, final PDF, and evidence records are present in `deliverables/final/` or the operation deliverables folder.
- Preserve the validation limits section so reviewers do not overstate synthetic replay confidence as production exploitability.
- Do not include operation-local memory or internal replay notes in customer-facing material.

## Appendix: Raw Evidence Index

Raw evidence lives under the operation evidence folder produced by the replay harness. The final handoff should include the rendered HTML, the lightweight PDF, the manifest, the runtime summary, the operation audit, the stage gate output, and the copied evidence records. This appendix exists to keep the final report complete enough for the lab while still making the authored-report preservation marker easy to verify in automation.
