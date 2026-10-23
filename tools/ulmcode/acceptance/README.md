# Independent runtime acceptance

These executable harnesses drive real public session/operation hosts against disposable state and loopback targets. They use the product implementation; they do not generate replacement product state or mock its HTTP API. No live profile, credential, paid API, scanner target or existing application process is used. Synthetic model transport does not prove subscription authentication.

Use the repository's declared Bun version (currently 1.4.4). Harness startup rejects a mismatched version; global Bun 1.3.9 is unsupported for this foundation. Evidence defaults to `/tmp/ulmcode-acceptance`; set `ULMCODE_ACCEPTANCE_OUTPUT` to a dedicated output directory if desired. Set `ULMCODE_CHROMIUM` to an actual Chromium executable for report rendering. All launched application processes are tracked and cleaned up by PID.

```bash
bun tools/ulmcode/acceptance/environment.ts --checkout <pristine-or-rebuild-checkout> --output <inventory.json>
bun tools/ulmcode/acceptance/upstream-baseline.ts --checkout <pristine-or-rebuild-checkout>
bun tools/ulmcode/acceptance/operations-api.ts
bun tools/ulmcode/acceptance/findings-api.ts
bun tools/ulmcode/acceptance/operation-restart.ts
bun tools/ulmcode/acceptance/profile-isolation.ts
PROFILE_ISOLATION_CONTROL=1 bun tools/ulmcode/acceptance/profile-isolation.ts
bun tools/ulmcode/acceptance/supervised-daemon.ts
bun tools/ulmcode/acceptance/worker-death.ts
ACCEPTANCE_SUPERVISED_RESTART_ONLY=1 bun tools/ulmcode/acceptance/supervised-daemon.ts
bun tools/ulmcode/acceptance/runtime-continuation.ts
bun tools/ulmcode/acceptance/runtime-findings.ts
RUNTIME_FIXTURE_VERDICT=done bun tools/ulmcode/acceptance/runtime-continuation.ts
RUNTIME_HOST_SCENARIO=approval-denial bun tools/ulmcode/acceptance/runtime-handoff.ts
RUNTIME_HOST_SCENARIO=handoff-complete bun tools/ulmcode/acceptance/runtime-handoff.ts
RUNTIME_HOST_SCENARIO=handoff-cancel-retry bun tools/ulmcode/acceptance/runtime-handoff.ts
RUNTIME_HOST_SCENARIO=authorized-catalog bun tools/ulmcode/acceptance/runtime-handoff.ts
RUNTIME_HOST_SCENARIO=authorized-no-catalog bun tools/ulmcode/acceptance/runtime-handoff.ts
RUNTIME_HOST_SCENARIO=authorized-invalid-profile bun tools/ulmcode/acceptance/runtime-handoff.ts
bun tools/ulmcode/acceptance/private-boundaries.ts
bun tools/ulmcode/acceptance/migration-interrupt.ts
bun tools/ulmcode/acceptance/migration-cli.ts
bun tools/ulmcode/acceptance/report-integrity.ts <completed-synthetic-operation-directory>
```

The pristine baseline verifies real CLI help/version, durable first/second submissions, upstream first-admission-wins message retry semantics, cross-session conflicts, steer/queue ordering, stop, admit-only/resume and process restart with explicit continuation. It creates a local OpenAI Chat-compatible transport; there is no API key or remote model call. Automatic orphan recovery belongs to upstream's managed service lifecycle and is not asserted for an unregistered standalone server.

The operation API harness creates an independently implemented loopback target, starts the real operation CLI server on an allocated port, and checks preapproval/goal gates, binding/traversal, actual request/receipt, repeat normalization, real HTML/PDF and final lint. The target returns an unvalidated candidate; the final report must not invent a validated finding.

The private-boundary harness generates credential values in memory, never prints them, checks review/scope/profile isolation and eight independent concurrent submission processes, and validates synthetic legacy migration dry-run/retry/source preservation. Generated private fixture files remain under a restricted private directory. Its assertions certify module boundaries, not the interactive vault or provider OAuth flow.

Report integrity attacks copy a completed synthetic operation into disposable variants and verify rejection of tampering, wrong identity, stale audit, wrong summary/PDF with recomputed hashes, extra files, traversal and symlink escapes. The original generated package remains intact. These attacks are negative tests, never a way to repair artifacts into a passing state.

`lab.ts --port 0 --ready <path>` is an independent optional loopback-only HTTP lab supporting malformed/slow/transient responses for manual runtime drills.

Real web and Electron verification remains required separately. On this WSL machine headless Chrome screenshots stalled; headed Chrome under isolated `xvfb-run -a` produced actual screenshots. DOM/CDP alone does not certify Electron compositor or native input. See the independent acceptance report for the accepted/failed/blocked/unverified matrix.

The native runtime fixtures start the actual profile launcher and plugin Host. Continuation covers tool registration, operation binding, stateless checker NO/YES, missing deterministic gates and the durable no-tool limit. Handoff scenarios exercise real HTTP permission rejection, child completion, cancellation and new-child retry. Catalog scenarios use only an explicitly trusted local executable and fail closed without the catalog/profile. Request evidence contains kind and tool names, not raw prompts or authentication values.

The profile isolation probe creates synthetic home/config/project poison, warms the actual plugin registry and waits for the primary model request with native tools. The negative control bypasses the isolated launcher in the same disposable state and demonstrates that the poison is detectable. It never changes the operator's home or profile.

The supervised daemon harness drives separate real CLI processes, command failure, credential environment/output redaction, concurrent dispatch, pipe-holder timeouts, daemon locking, signal restart, explicit operator-stop preservation and autonomous actual PDF/audit closeout. `ACCEPTANCE_SUPERVISED_RESTART_ONLY=1` selects just restart/stop cases. `worker-death.ts` kills the actual detached worker while its TERM-resistant command and pipe holder run, makes no product inspection until after the hard deadline, then checks OS process state and duplicate suppression. Check the acceptance report for its current result.

Real headed browser vault checks require an installed Playwright and display:

```bash
xvfb-run -a bun tools/ulmcode/acceptance/vault-browser.ts
xvfb-run -a bun tools/ulmcode/acceptance/app-vault-link.ts --password-file <private-0600-file> --operation <existing-synthetic-operation-id>
```

The standalone vault harness submits generated private values and records blank/success screenshots only; the success handle is masked. The app-link harness requires the documented dedicated app/backend/API ports and opens an empty form only. Do not supply a password value as a command argument or capture a filled credential form.

`migration-interrupt.ts` creates only synthetic legacy data, SIGKILLs its own migrator after actual partial archive writes, checks source hashes, and starts new processes to recover and repeat the original plan. It verifies the imported operation and every evidence hash. This proves that exercised interruption boundary, not arbitrary machine power-loss durability.

`migration-cli.ts` drives the operator plan/apply commands in separate processes, checks confirm/modes/redaction/review status/source preservation and challenges both leaf and ancestor symlinks in private output paths. It reports failures instead of modifying product behavior.

`findings-api.ts` exercises the real HTTP source-artifact and finding workflow, including immutable hashes, path containment, candidate omission, required review/known evidence, duplicate IDs, completion invalidation, rerendering and normalization rejection before writes when registered source bytes change. `runtime-findings.ts` drives actual model tool calls through the native plugin and produces a canonical PDF from a reviewed, explicitly synthetic finding.

After building a Linux unpacked desktop package, verify compiled Host/native supervised execution with the shipped payload:

```bash
ULMCODE_ACCEPTANCE_PACKAGE_RESOURCES="$PWD/packages/desktop/dist/linux-unpacked/resources" RUNTIME_HOST_SCENARIO=authorized-catalog bun tools/ulmcode/acceptance/runtime-handoff.ts
```

This launches the shipped compiled CLI and bundled plugin directly with `PATH=/usr/bin:/bin` and an explicit shipped worker Bun. It checks that system Bun is absent, records the actual resource identities, and requires a single successful supervised receipt. Wait until packaging finishes before running; the packager replaces its output directory.
