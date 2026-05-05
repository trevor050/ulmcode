# ULMCode Labs

This directory contains manifest-driven synthetic labs for replaying ULMCode operation flows without touching real targets.

Run the bundled replay check from the repo root:

```sh
bun run --cwd packages/opencode test:ulm-lab
```

Each lab manifest defines the operation objective, execution plan, evidence records, expected findings, runtime usage, optional report page budget, and assertions for the generated handoff artifacts. The replay runner writes a temporary `.ulmcode/operations/<id>/` tree, enforces the validation stage gate, renders final deliverables, writes a runtime summary, writes an operation audit, and requires final handoff lint plus outline-budget lint to pass. The package command replays every `*/manifest.json` in this directory so new labs are automatically covered.

Bundled labs:

- `k12-login-mfa-gap`: privileged-login MFA policy weakness.
- `k12-roster-idor`: roster API cross-tenant read exposure.
- `k12-gradebook-mass-assignment`: student-controlled gradebook write escalation.
- `k12-storage-config-leak`: public storage config and unauthenticated student-support file read.
- `k12-student-search-injection`: unsafe student search query construction.

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
```
