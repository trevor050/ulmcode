# Independent runtime acceptance

These executable harnesses drive real public session/operation hosts against disposable state and loopback targets. They use the product implementation; they do not generate replacement product state or mock its HTTP API. No live profile, credential, paid API, scanner target or existing application process is used. Synthetic model transport does not prove subscription authentication.

Use the repository's declared Bun version. Evidence defaults to `/tmp/ulmcode-acceptance`; set `ULMCODE_ACCEPTANCE_OUTPUT` to a dedicated output directory if desired. Set `ULMCODE_CHROMIUM` to an actual Chromium executable for report rendering. All launched application processes are tracked and cleaned up by PID.

```bash
bun tools/ulmcode/acceptance/environment.ts --checkout <pristine-or-rebuild-checkout> --output <inventory.json>
bun tools/ulmcode/acceptance/upstream-baseline.ts --checkout <pristine-or-rebuild-checkout>
bun tools/ulmcode/acceptance/operations-api.ts
bun tools/ulmcode/acceptance/private-boundaries.ts
bun tools/ulmcode/acceptance/report-integrity.ts <completed-synthetic-operation-directory>
```

The pristine baseline verifies real CLI help/version, durable first/second submissions, upstream first-admission-wins message retry semantics, cross-session conflicts, steer/queue ordering, stop, admit-only/resume and process restart with explicit continuation. It creates a local OpenAI Chat-compatible transport; there is no API key or remote model call. Automatic orphan recovery belongs to upstream's managed service lifecycle and is not asserted for an unregistered standalone server.

The operation API harness creates an independently implemented loopback target, starts the real operation CLI server on an allocated port, and checks preapproval/goal gates, binding/traversal, actual request/receipt, repeat normalization, real HTML/PDF and final lint. The target returns an unvalidated candidate; the final report must not invent a validated finding.

The private-boundary harness generates credential values in memory, never prints them, checks review/scope/profile isolation and eight independent concurrent submission processes, and validates synthetic legacy migration dry-run/retry/source preservation. Generated private fixture files remain under a restricted private directory. Its assertions certify module boundaries, not the interactive vault or provider OAuth flow.

Report integrity attacks copy a completed synthetic operation into disposable variants and verify rejection of tampering, wrong identity, stale audit, wrong summary/PDF with recomputed hashes, extra files, traversal and symlink escapes. The original generated package remains intact. These attacks are negative tests, never a way to repair artifacts into a passing state.

`lab.ts --port 0 --ready <path>` is an independent optional loopback-only HTTP lab supporting malformed/slow/transient responses for manual runtime drills.

Real web and Electron verification remains required separately. On this WSL machine headless Chrome screenshots stalled; headed Chrome under isolated `xvfb-run -a` produced actual screenshots. DOM/CDP alone does not certify Electron compositor or native input. See the independent acceptance report for the accepted/failed/blocked/unverified matrix.
