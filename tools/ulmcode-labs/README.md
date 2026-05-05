# ULMCode Labs

This directory contains manifest-driven synthetic labs for replaying ULMCode operation flows without touching real targets.

Run the bundled replay check from the repo root:

```sh
bun run --cwd packages/opencode test:ulm-lab
```

Each lab manifest defines the operation objective, execution plan, evidence records, expected findings, runtime usage, optional report page budget, and assertions for the generated handoff artifacts. The replay runner writes a temporary `.ulmcode/operations/<id>/` tree, enforces the validation stage gate, renders final deliverables, writes a runtime summary, writes an operation audit, and requires final handoff lint plus outline-budget and outline-section lint to pass. The package command replays every `*/manifest.json` in this directory so new labs are automatically covered.

Bundled labs:

- `k12-login-mfa-gap`: privileged-login MFA policy weakness.
- `k12-roster-idor`: roster API cross-tenant read exposure.
- `k12-gradebook-mass-assignment`: student-controlled gradebook write escalation.
- `k12-storage-config-leak`: public storage config and unauthenticated student-support file read.
- `k12-student-search-injection`: unsafe student search query construction.
- `k12-password-reset-token-leak`: exposed password-reset tokens in unauthenticated support audit logs.
- `k12-guardian-invite-takeover`: exposed guardian invite code and unauthorized family-portal account linking.
- `k12-lti-shared-secret-leak`: public LTI shared secret disclosure and forged instructor launch.
- `k12-sis-webhook-signature-bypass`: unsigned SIS webhook event replay that changes guardian contact records.
- `k12-assignment-submission-impersonation`: client-supplied student owner lets one student submit work as another.
- `k12-attendance-bulk-update-csrf`: cross-site attendance bulk update accepted with ambient teacher cookies.
- `k12-transcript-export-overexposure`: teacher transcript export can request sensitive student fields.
- `k12-lms-payment-webhook-replay`: stale unsigned payment webhook replay can alter student fee balances.
- `k12-family-messaging-cross-class-broadcast`: client-supplied class id lets a teacher broadcast to another class's guardians.
- `k12-third-party-integration-token-leak`: exposed vendor OAuth token grants roster preview and sync access.
- `k12-district-portal-chained-exposure`: multi-finding district portal case covering admin MFA and cross-district sensitive export exposure.
- `k12-sso-roster-export-chain`: multi-finding SSO chain covering callback policy, cross-district roster export, vendor sync scopes, and audit gaps.

The labs include tiny intentionally weak HTTP services under `service/`. Probe them without Docker:

```sh
bun run --cwd packages/opencode test:ulm-lab-target
```

Or run it with Docker Compose:

```sh
docker compose -f tools/ulmcode-labs/k12-login-mfa-gap/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-roster-idor/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-gradebook-mass-assignment/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-storage-config-leak/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-student-search-injection/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-password-reset-token-leak/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-guardian-invite-takeover/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-lti-shared-secret-leak/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-sis-webhook-signature-bypass/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-assignment-submission-impersonation/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-attendance-bulk-update-csrf/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-transcript-export-overexposure/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-lms-payment-webhook-replay/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-family-messaging-cross-class-broadcast/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-third-party-integration-token-leak/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-district-portal-chained-exposure/docker-compose.yml up --build
docker compose -f tools/ulmcode-labs/k12-sso-roster-export-chain/docker-compose.yml up --build
```
