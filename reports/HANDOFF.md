# ULMCode rebuild handoff

The rebuild lives in `/home/trevor/swarm-work/ulmcode-v2` on `ulmcode-two`. Its foundation is official OpenCode V2 `v2.1.3`, immutable commit `bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1`. The original checkout and `local-reference` at `6a3df0d8bd64b3f9ab0fac0bba524887e08773f5` are preserved. Only the stream branch is pushed; the default branch is unchanged.

The implementation uses the official session runner, native plugin API and Electron/app surfaces. One operation package owns durable approved plans, execution receipts, supervised process deadlines, interruption/recovery, private credential handles, subordinate handoffs, goal continuation, immutable evidence, reviewed findings and audited styled HTML/PDF reports. Independent acceptance uses real processes and synthetic loopback targets/model transport, with no paid provider keys, live profiles or external targets.

## Reproduce locally

Use Bun **1.4.4**. On this machine it is installed at `/home/trevor/swarm-control/ulmcode/tooling/package/bin/bun`; prepend its directory to `PATH` before commands, including Git hooks. Global Bun 1.3.9 is unsupported.

```sh
cd /home/trevor/swarm-work/ulmcode-v2
bun install --frozen-lockfile
ULMCODE_PROFILE_ROOT=/tmp/ulmcode-review-profile bun run ulm:chat --help
```

[README.ULMCODE.md](../README.ULMCODE.md) contains the complete local operation and detached-daemon workflow. Start the deliberately synthetic lab with `bun run ulm:lab`; start the operation API with an explicit temporary workspace/profile and a real Chromium path. The documented `create`, `approve`, `run`, `normalize` and `report` commands reach canonical persisted state and actual PDF output. New evidence is registered through `artifacts`, findings through `findings`; candidates and stale/tampered sources cannot pass final handoff.

For the Linux desktop directory package:

```sh
cd packages/desktop
bun run package:ulm --linux --dir
```

The ULM packaging command builds this checkout's CLI and app, bundles the native plugin, real Bun worker runtime and operation service, and disables registry CLI substitution. See [DESKTOP.md](DESKTOP.md) for disposable-profile launch commands, native screenshots, process isolation and exact package evidence. The app owns its matching loopback operation service and refuses an occupied port belonging to another workspace/profile.

## Verification and evidence

The independent [acceptance matrix](ACCEPTANCE.md) records accepted behavior and practical limits. Portable actual-runtime harnesses and exact invocation commands are in [tools/ulmcode/acceptance](../tools/ulmcode/acceptance/README.md). The report directory outside Git, `/home/trevor/swarm-control/ulmcode/reports`, retains full provenance, implementation reviews, test/build logs and final status.

Required checks run from their owning directories: `bun typecheck` and `bun test --timeout 30000` in `packages/ulm`; package typechecks/builds for the app and desktop; repository `bun run check` for canonical lint/typechecking. No acceptance thresholds, artifact gates or test exclusions were lowered to finish.

Migration is explicit and opt-in. [MIGRATION.md](../docs/ulmcode/MIGRATION.md) documents the private plan/apply CLI, supported conversion, source preservation, review-required imported credentials and safe same-plan retry. It never automatically imports a home profile. No live user data was migrated during acceptance.

## Known limits

Finite approved graphs are implemented and independently exercised. Legacy Discovery Charters, automatic campaign/backlog renewal, school launch packets and stakeholder-specific report templates are unsupported. Live subscription authentication/refresh and literal long-duration unattended trust remain unverified. The packaged Linux desktop was exercised; native Windows/macOS installers and Windows process supervision need separate validation. The upstream renderer retains some OpenCode branding. This handoff makes no production or live-engagement readiness claim from synthetic results.
