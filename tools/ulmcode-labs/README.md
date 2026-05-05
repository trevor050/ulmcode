# ULMCode Labs

This directory contains manifest-driven synthetic labs for replaying ULMCode operation flows without touching real targets.

Run the bundled replay check from the repo root:

```sh
bun run --cwd packages/opencode test:ulm-lab
```

Each lab manifest defines the operation objective, execution plan, evidence records, expected findings, runtime usage, and assertions for the generated handoff artifacts. The replay runner writes a temporary `.ulmcode/operations/<id>/` tree, renders final deliverables, writes a runtime summary, and requires `finalHandoff` lint to pass.

The `k12-login-mfa-gap` lab also includes a tiny intentionally weak HTTP service under `service/`. Probe it without Docker:

```sh
bun run --cwd packages/opencode test:ulm-lab-target
```

Or run it with Docker Compose:

```sh
docker compose -f tools/ulmcode-labs/k12-login-mfa-gap/docker-compose.yml up --build
```
