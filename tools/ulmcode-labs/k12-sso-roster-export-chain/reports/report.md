# Authored SSO Roster Export Chain Assessment

`sso-roster-chain-authored-marker`

## Executive Summary

The synthetic SSO roster export chain demonstrates how identity configuration, data export controls, vendor integration scopes, and audit coverage can fail together. Three report-ready findings were validated: an overbroad SSO callback policy creates an administrator session without step-up authentication, that session can export sensitive roster fields across all districts, and the same session can approve excessive vendor sync scopes without elevated audit signals. The highest-priority risk is not any single endpoint by itself. It is the chain from administrator session creation to bulk student-data exposure and vendor synchronization.

## Scope, Authorization, and Methodology

This replay uses only intentionally vulnerable local lab services and fabricated records. No real identity provider, roster system, vendor integration, student account, guardian contact, or district tenant is contacted. The methodology follows a plan-first operation: enumerate the synthetic SSO configuration, validate administrator session exchange behavior, use that session to exercise roster and vendor workflows, inspect audit coverage, record evidence artifacts, write findings, and render final handoff artifacts with strict report gates. Each finding cites stored evidence IDs rather than relying on chat-only assertions.

## Environment Overview

The target represents a district administration environment with an SSO callback configuration endpoint, an assertion exchange endpoint, a roster export API, a vendor synchronization API, and an audit event API. The SSO configuration includes a localhost callback and does not require signed RelayState. The exchange endpoint returns a district-admin session without MFA. The roster endpoint accepts that session and returns student support and guardian-related fields across all districts. The vendor sync endpoint accepts broad scopes including `student-support:read`, while audit events remain informational.

## Attack Path Narrative

The chained path begins with a permissive SSO callback configuration that accepts localhost redirect targets and unsigned RelayState. In the synthetic flow, that weakness allows an administrator assertion exchange to produce an admin session without a step-up challenge. The session then reaches the roster export endpoint and requests all fields across all district tenants, exposing fields such as IEP status, guardian email, and homelessness status. The attacker can then approve a vendor sync using the same session, granting roster, guardian, and student-support scopes. Audit data does not elevate the export or vendor action.

## Findings Detail

The first finding is that SSO callback policy enables administrator session creation without step-up. Evidence `ev-sso-config` shows the localhost callback and unsigned RelayState condition. Evidence `ev-sso-exchange` shows the resulting district-admin session and absence of MFA. The impact is high because a weak identity boundary becomes the entry point for later student-data actions. Remediation should restrict callback URLs, require signed RelayState, enforce phishing-resistant MFA, and require step-up before privileged workflows.

The second finding is the critical roster export exposure. Evidence `ev-roster-export` shows an authorized all-district export containing sensitive fields. Evidence `ev-sso-exchange` links that action back to the SSO-created administrator session. Remediation should enforce tenant scoping server-side, separate sensitive fields behind explicit purpose-based approval, limit bulk export size, and add regression tests proving one district context cannot export another district's data.

The third finding is excessive vendor sync scope without elevated audit coverage. Evidence `ev-vendor-sync` shows approval of roster, guardian, and student-support scopes without an additional approval requirement. Evidence `ev-chain-audit-gap` shows informational events and no elevated export or vendor alert. Remediation should split vendor grants by purpose, require approval for sensitive scopes, and elevate audit events for login-to-export-to-sync chains.

## Risk Register and Prioritized Roadmap

Priority one is server-side tenant scoping and sensitive-field restriction on roster exports, because it directly limits bulk student-data exposure even if an administrator session is compromised. Priority two is SSO hardening: remove localhost callbacks from production, require signed RelayState, and mandate administrator MFA plus step-up for exports and vendor sync. Priority three is vendor-scope governance with explicit approvals and short-lived, purpose-limited tokens. Priority four is audit elevation for chained workflows, especially when a new session quickly performs export and vendor synchronization actions.

## Validation Limits and Known Unknowns

This lab is synthetic and does not prove exploitability in a real district environment. It does not test a production IdP, real SAML or OIDC signing behavior, true tenant data models, vendor contract requirements, alert delivery paths, or incident response playbooks. It also does not attempt persistence, destructive data modification, or privilege escalation beyond the fabricated district-admin role. A real engagement would add production-safe configuration review, controlled identity-provider validation, stakeholder-approved export tests, SIEM alert confirmation, and vendor authorization review.

## Evidence Map

The SSO finding cites `ev-sso-config` and `ev-sso-exchange`. The roster export finding cites `ev-sso-exchange` and `ev-roster-export`. The vendor and audit finding cites `ev-vendor-sync` and `ev-chain-audit-gap`. The evidence set is intentionally compact but covers the full chain: configuration, session creation, data export, vendor synchronization, and audit weakness. This makes the lab useful for testing whether ULMCode can preserve a multi-finding narrative and still produce report artifacts with clear evidence attribution.

## Appendix: Raw Evidence Index

Raw evidence is stored under the operation evidence directory created by the replay harness. The final handoff should include rendered HTML, rendered PDF text, manifest metadata, operation audit output, validation stage gate output, runtime summary, and copied evidence records. The authored report marker above verifies that report rendering preserves operator-authored narrative. The section structure verifies that report lint enforces outline coverage instead of accepting a sparse executive summary with findings pasted underneath.
