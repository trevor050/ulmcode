# ULMCode 20-Hour Autonomy Completion Audit

Last updated: 2026-05-05

## Objective

ULMCode should be able to run an authorized non-destructive pentest operation unattended for 20+ hours, keep useful work moving across model and command lanes, recover from stale work and restarts, preserve coherent evidence/findings/report state, manage context/cost/quota pressure by model route, and end with a client-reviewable final package.

## Prompt-To-Artifact Checklist

| Requirement | Required evidence | Current status |
| --- | --- | --- |
| Research-first architecture hub | `docs/ulm-autonomy/` decision docs with cited patterns and rejected approaches | Partial. Hub exists; needs deeper source refresh as implementation evolves. |
| Model-aware runtime governor | Provider-derived limits, route costs, lane budgets, context pressure, compaction/stop decisions | Partial. Implemented model catalog, context/cost cliffs, lane spend, hard/soft route quota checks, fallback route metadata, and durable model-route audits against the configured provider list. Still needs live quota telemetry from actual providers where exposed. |
| OpenCode Go + ChatGPT Pro route strategy | Concrete route metadata, fallback policy, and measured usage behavior | Partial. Routes are represented, provider-list availability is auditable, and governor can enforce metadata, but live provider quota balances are not fully verified. |
| Durable operation graph | Persisted phases, lanes, dependencies, safety mode, expected artifacts, recovery policy | Implemented through `operation_schedule`, `operation_run`, and graph validation. |
| Default `non_destructive` unattended mode | Manifest/profile validation rejecting unattended destructive profiles | Implemented in tool manifest validation and work queue checks. |
| Human-present destructive mode | Explicit `interactive_destructive` classification | Partial. Manifest policy represents it; runtime UX/human-presence gate is not deeply exercised. |
| Long command supervision | Background command profiles with heartbeats, idle/hard timeouts, artifacts, restart metadata | Partial. Manifest-backed profiles launch through scheduler/daemon owner hooks with `dryRun:false`; needs broader real-tool catalog validation on a clean install. |
| Subagent scheduler | Parallel lanes with model route, allowed tools, budgets, expected output, restart policy | Partial. Graph/lane scheduling exists and scheduler/daemon can now launch model lanes through background `task`; needs live multi-agent burn-in proof. |
| Autonomous tool acquisition | Manifest install/validate/blocker/fallback records | Partial. Single-tool acquisition and manifest-wide clean-machine preflight are implemented; actual installation of the full catalog on a clean machine remains unproven. |
| Evidence/finding factory | Normalized hosts/services/URLs/screenshots/auth/cloud/SaaS leads and validated findings | Partial. Parsers now cover hosts/services, URLs, DNS, web paths, ZAP alerts, screenshot manifests, TLS certificates, cloud assets, and auth surfaces; real-tool fixture coverage for every profile still needs expansion. |
| Report factory | Final `report.pdf`, `report.html`, `findings.json`, `evidence-index.json`, operator/executive/technical/runtime docs, manifest | Implemented final package enforcement with integrity checks for manifest paths, parseable JSON, PDF/HTML signatures, and stale runtime-summary copies; needs real long-run report quality burn-in. |
| Harness expansion | `fast`, `full`, `chaos`, `overnight` tiers | Implemented as readiness/eval harness. Overnight is not a literal 20-hour run. |
| Actual 20+ hour operation proof | Wall-clock daemon run or accelerated burn-in with explicit proof artifact plus real operator-triggered 20-hour command | Partial. Accelerated burn-in proof artifact exists and is required by overnight readiness; launchd/systemd supervisor artifacts can now be generated for OS-owned runs; `ulm:literal-run-readiness` writes a strict wall-clock proof audit; literal 20-hour live run is still required. |
| Completion audit | Requirement-by-requirement proof, not proxy green tests | This file. It is intentionally not a completion claim. |

## Current Hard Gaps

- No literal 20-hour run has been executed and archived.
- Provider quotas are represented in metadata, route availability is audited against configured providers, and quotas are enforced when present, but remaining live ChatGPT/Codex/OpenCode Go account balances are not discovered where providers do not expose them.
- CLI detached daemon runs the scheduler, and `--supervisor all` generates launchd/systemd user-service artifacts plus install runbook. `ulm:literal-run-readiness --strict --json` distinguishes setup readiness from proved wall-clock runtime. Actual service installation and a literal 20-hour service-managed run are still not executed in this branch.
- Tool acquisition has fallback/blocker logic and a manifest-wide clean-machine preflight artifact, but actual clean-machine installation coverage is not yet proven for the full catalog.
- The final package gate is strict, but a long-run report assembled from real background lanes has not been produced in this branch.
- Command-profile execution is now daemon/scheduler-owned for queued work units, and the evidence factory can normalize more artifact classes, but real-tool success still needs clean-machine and live-lab validation.

## Next Concrete Work

1. Run a literal service-managed 20-hour operation using the generated `--supervisor all` artifacts and archive heartbeat/log/runtime-summary/final-audit evidence plus `scheduler/literal-run-readiness.json`.
2. Expand runtime governor inputs to record live provider quota balances where the provider exposes them.
3. Prove full tool catalog installation on a clean machine and archive `tool-preflight.json`.
4. Run a real long lab once clean-machine tools and service-manager supervision are proven.
