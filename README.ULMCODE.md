# ULMCode on OpenCode 2

ULMCode is an independent authorized internal security orchestration product rebuilt on official OpenCode V2. It is not affiliated with Anomaly or the OpenCode maintainers. Upstream source is pinned to **v2.1.3**, commit `bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1`; the original fork is preserved separately as `local-reference` at `6a3df0d8bd64b3f9ab0fac0bba524887e08773f5`.

Use **Bun 1.4.4**. Preserve the upstream MIT notice. Foundation provenance and the distinction between official V2 tags and the older GitHub release channel are in [UPSTREAM.md](docs/ulmcode/UPSTREAM.md). Module boundaries and migration policy are in [ARCHITECTURE.md](docs/ulmcode/ARCHITECTURE.md) and [MIGRATION.md](docs/ulmcode/MIGRATION.md).

## Local setup

```sh
bun install --frozen-lockfile
# Isolate all configuration, provider auth, databases and private credential storage.
ULMCODE_PROFILE_ROOT=/tmp/ulmcode-review-profile bun run ulm:chat --help
```

The launcher excludes system/global and project discovery, including personal `.agents` and `.claude` directories, while loading its explicit profile configuration. The profile launcher uses the native V2 plugin interface and upstream OpenAI subscription authentication. It removes inherited API-key/endpoint/auth-content overrides. Do not use a live profile for migration or acceptance. Canonical operation artifacts are workspace-scoped `.ulmcode/operations/<id>/`; each folder contains transactional `operation.db`, readable `operation.json`, evidence and final deliverables. Fresh chats never silently select the newest operation.

## Synthetic local operation

In separate terminals start the target and operations host. The target is a deliberately synthetic loopback HTTP service, with no real pentest targets.

```sh
bun run ulm:lab
bun run ulm:serve --workspace /tmp/ulmcode-review-workspace --profile-root /tmp/ulmcode-review-profile --chromium /path/to/chromium
```

Run the persisted workflow against that workspace:

```sh
bun run ulm create local-review --workspace /tmp/ulmcode-review-workspace
bun run ulm approve local-review --workspace /tmp/ulmcode-review-workspace --operator local-reviewer
bun run ulm run local-review --workspace /tmp/ulmcode-review-workspace
bun run ulm run local-review --workspace /tmp/ulmcode-review-workspace
bun run ulm normalize local-review --workspace /tmp/ulmcode-review-workspace
bun run ulm report local-review --workspace /tmp/ulmcode-review-workspace --chromium /path/to/chromium
bun run ulm status local-review --workspace /tmp/ulmcode-review-workspace
```

The first run records intent and a durable execution receipt; the second reconciles the result. Report rendering generates real styled HTML and Chromium PDF, a runtime summary and hashed manifest under `deliverables/final/`. Completion requires deterministic source, format, evidence and report gates. A checker saying done cannot bypass missing or stale artifacts. Chromium is required for PDF output; rendering failures leave the goal open.

The HTTP host binds `127.0.0.1:4310`, the fake lab binds `127.0.0.1:4320`, and the integrated app runs at `http://localhost:4444` using `bun run ulm:app`. The app also needs a separately started, isolated OpenCode backend on 4096; use the upstream CLI server commands through `tools/ulmcode/launch.ts`, then pair through the app. The Operations entry is secondary to recent chats. Session headers explicitly attach operation context. The local execution adapter accepts only scoped loopback lab origins; external target dispatch is not enabled by this runbook.

## Checks and acceptance

```sh
cd packages/ulm
bun typecheck
bun test --timeout 30000
```

Run `bun typecheck` in `packages/app` and `packages/cli`, `bun run build` in `packages/app`, and `bun run lint` from the worktree root. Independent acceptance scripts and evidence instructions live under `tools/ulmcode/acceptance` when handed off. Current acceptance status is tracked separately; passing unit tests does not certify live subscription auth, desktop input, or long-duration unattended behavior.

Never migrate real credentials as a test, print provider tokens, scan external targets, or claim the synthetic observations as validated real-world findings. Migration uses explicit source and destination roots, preserves source bytes, and requires reauthentication/review for incompatible private state.

## Supervised commands and unattended closeout

Command phases select a profile from an explicitly enabled trusted catalog; they do not accept arbitrary shell text. The included `tools/ulmcode/command-catalog.json` is loopback-only and collects actual lab observations in a detached subprocess. A plan phase can declare:

```json
{
  "command": {
    "profileID": "local-http-observe",
    "variables": { "target": "http://127.0.0.1:4320" }
  }
}
```

Use this field inside a complete approved phase with ordered dependencies and success criteria. Enable the catalog for the operation host with `--command-catalog tools/ulmcode/command-catalog.json`. Without it a command phase is blocked; HTTP-lab proof never substitutes for requested command execution. Authorized scope additionally requires an opaque authorization reference and a catalog profile permitting it. This runbook invokes only the synthetic lab.

```sh
bun run ulm:daemon local-review --workspace /tmp/ulmcode-review-workspace \
  --command-catalog tools/ulmcode/command-catalog.json \
  --chromium /path/to/chromium --detach
```

The parent confirms a real persisted scheduler heartbeat before returning. The scheduler drives the approved graph, normalizes evidence, renders and audits the package. Its per-operation lock prevents simultaneous supervisors. SIGTERM interrupts owned work; `--resume` can recover a scheduler shutdown, while an explicit operator stop requires `recover`. An open duration window returns an expansion request; elapsed-time readiness is never inferred from accelerated work. Receipts, failure outputs and checkpoints survive process restart.

For native chat use explicit `ULMCODE_COMMAND_CATALOG=/absolute/trusted-catalog.json`; `ULMCODE_BUN_PATH=/path/to/bun` selects the real interpreter for detached workers, and `ULMCODE_CHROMIUM=/path/to/chromium` selects the PDF renderer. A compiled host must provide a real Bun interpreter and worker asset. The current supervised process adapter uses POSIX process identity/group semantics; Windows-native execution needs separate validation. Secrets are materialized from reviewed opaque handles into the child environment and redacted before output artifacts are written.
