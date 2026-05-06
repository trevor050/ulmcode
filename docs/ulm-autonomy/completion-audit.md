# ULMCode 20-Hour Autonomy Completion Audit

Last updated: 2026-05-06

## Objective

ULMCode should be able to run an authorized non-destructive pentest operation unattended for 20+ hours, keep useful work moving across model and command lanes, recover from stale work and restarts, preserve coherent evidence/findings/report state, manage context/cost/quota pressure by model route, and end with a client-reviewable final package.

## Prompt-To-Artifact Checklist

| Requirement | Required evidence | Current status |
| --- | --- | --- |
| Research-first architecture hub | `docs/ulm-autonomy/` decision docs with cited patterns and rejected approaches | Implemented for this slice. `docs/ulm-autonomy/overnight-supervisor.md` captures the overnight supervisor architecture, OMO/Plannotator integration stance, foreground command policy, and verification commands. |
| Durable operation goal | Explicit objective, target duration, status, blockers, completion gates | Implemented through `operation_goal` and `packages/opencode/src/ulm/operation-goal.ts`. Completion is blocked until final artifacts and audit evidence exist. |
| Duration-aware pentest kickoff | Under-two-hour compact planning and 20-36 hour plan-plan/supervised path | Implemented in kickoff policy and prompt guidance. Missing duration, authorization, and scope block broad execution. |
| Adaptive plan-plan workflow | Passive discovery, follow-up questions, plan-plan, critic pass, full operation plan | Implemented as policy/prompt/runtime contract. Plannotator is a critic lane, not the durable state owner. |
| Supervisor model | Durable supervisor reviews that can block, recover, schedule, pause, or approve handoff | Implemented through `operation_supervise`, scheduler cadence hooks, daemon flags, status surfaces, and compact prompt context. |
| Aggressive subagent orchestration | Parallel lanes with model route, allowed tools, budgets, expected output, restart policy | Implemented through operation graphs, scheduler-owned task launches, restart metadata, and supervisor lane validation. Needs literal multi-agent wall-clock burn-in beyond accelerated harness proof. |
| Model-aware runtime governor | Provider-derived limits, route costs, lane budgets, context pressure, compaction/stop decisions | Partial. Implemented model catalog, context/cost cliffs, lane spend, hard/soft route quota checks, fallback route metadata, and durable model-route audits against the configured provider list. Still needs live quota telemetry from actual providers where exposed. |
| OpenCode Go + ChatGPT Pro route strategy | Concrete route metadata, fallback policy, and measured usage behavior | Partial. Routes are represented, provider-list availability is auditable, and governor can enforce metadata, but live provider quota balances are not fully verified. |
| Durable operation graph | Persisted phases, lanes, dependencies, safety mode, expected artifacts, recovery policy | Implemented through `operation_schedule`, `operation_run`, and graph validation. |
| Default `non_destructive` unattended mode | Manifest/profile validation rejecting unattended destructive profiles | Implemented in tool manifest validation and work queue checks. |
| Human-present destructive mode | Explicit `interactive_destructive` classification | Partial. Manifest policy represents it; runtime UX/human-presence gate is not deeply exercised. |
| Long command supervision | Background command profiles with heartbeats, idle/hard timeouts, artifacts, restart metadata | Implemented for the internal runtime contract. Foreground commands expected to exceed two minutes are explicitly redirected to supervised/background profiles, and the scheduler/daemon can own command work units. Needs broader real-tool catalog validation on a clean install. |
| Autonomous tool acquisition | Manifest install/validate/blocker/fallback records | Partial. Single-tool acquisition and manifest-wide clean-machine preflight are implemented; actual installation of the full catalog on a clean machine remains unproven. |
| Local cybersecurity package/tool visibility | Durable inventory of installed/missing tools and high-value missing tools | Implemented through `tool_inventory`, operation artifacts, status summaries, and compact system prompt context. |
| Evidence/finding factory | Normalized hosts/services/URLs/screenshots/auth/cloud/SaaS leads and validated findings | Partial. Parsers now cover hosts/services, URLs, DNS, web paths, ZAP alerts, screenshot manifests, TLS certificates, cloud assets, and auth surfaces; real-tool fixture coverage for every profile still needs expansion. |
| Report factory | Final `report.pdf`, `report.html`, `findings.json`, `evidence-index.json`, operator/executive/technical/runtime docs, manifest | Implemented final package enforcement with integrity checks for manifest paths, parseable JSON, PDF/HTML signatures, and stale runtime-summary copies; needs real long-run report quality burn-in. |
| Harness expansion | `fast`, `full`, `chaos`, `overnight` tiers | Implemented as readiness/eval harness. Overnight now proves supervisor scenario setup, stale command recovery, operation goal gates, final audit blocking, and final audit completion. It is not a literal 20-hour run. |
| Actual 20+ hour operation proof | Wall-clock daemon run with useful work proof, or accelerated burn-in/service-manager setup as readiness-only evidence plus real operator-triggered 20-hour command | Partial. Accelerated burn-in proof artifact exists and is required by overnight readiness; launchd/systemd supervisor artifacts can now be generated for OS-owned runs; `ulm:literal-run-readiness` now requires both wall-clock runtime proof and useful work proof before passing; literal 20-hour live run is still required. |
| Completion audit | Requirement-by-requirement proof, not proxy green tests | This file plus the live plan checklist. It records implemented surfaces, verified commands, and literal-run residual risk. |

## Current Hard Gaps

- No literal 20-hour run has been executed and archived. The accelerated overnight harness is readiness proof only.
- Provider quotas are represented in metadata, route availability is audited against configured providers, and quotas are enforced when present, but remaining live ChatGPT/Codex/OpenCode Go account balances are not discovered where providers do not expose them.
- CLI detached daemon runs the scheduler, and `--supervisor all` generates launchd/systemd user-service artifacts plus install runbook. `ulm:literal-run-readiness --strict --json` distinguishes setup readiness, idle wall-clock daemon proof, and useful work proof. Actual service installation and a literal 20-hour service-managed run are still not executed in this branch.
- Tool acquisition has fallback/blocker logic and a manifest-wide clean-machine preflight artifact, but actual clean-machine installation coverage is not yet proven for the full catalog.
- The final package gate is strict, but a long-run report assembled from real background lanes has not been produced in this branch.
- Command-profile execution is now daemon/scheduler-owned for queued work units, and the evidence factory can normalize more artifact classes, but real-tool success still needs clean-machine and live-lab validation.

## Final Verification Evidence

Run from `packages/opencode` on 2026-05-06:

- `bun test test/ulm/operation-goal.test.ts test/tool/operation_goal.test.ts`: 7 pass.
- `bun test test/ulm/tool-inventory.test.ts test/tool/tool_inventory.test.ts`: 4 pass.
- `bun test test/ulm/pentest-kickoff.test.ts`: 6 pass.
- `bun test test/ulm/operation-supervisor.test.ts test/tool/operation_supervise.test.ts`: 5 pass.
- `bun run test:ulm-tool-manifest`: `ulm_tool_manifest: ok (16 tools, 16 profiles)`.
- `bun run test:ulm-skills`: `ulm_profile_skills: ok`, `routing: ok`, `skills: 11`, `commands: 11`.
- `bun run test:ulm-rebuild-audit`: all categories ok.
- `bun run test:ulm-smoke`: `ulm_lifecycle_smoke: ok`.
- `bun run test:ulm-harness:fast`: all fast scenarios passed.
- `bun run test:ulm-harness:overnight`: `overnight-readiness-contract` passed.
- `bun test test/ulm`: 140 pass, 0 fail.
- `bun test test/tool`: 276 pass, 0 fail.
- `bun test test/session`: 312 pass, 4 skipped, 1 todo, 0 fail.
- `bun run typecheck`: pass.

During final verification, stale expectations were fixed for the expanded profile skill count, lab replay test timeout, and task tool schema snapshot. The underlying lab replay command succeeded directly in about seven seconds; the test timeout was the incorrect assumption.

## Next Concrete Work

1. Run a literal service-managed 20-hour operation using the generated `--supervisor all` artifacts and archive heartbeat/log/runtime-summary/final-audit evidence plus `scheduler/literal-run-readiness.json`.
2. Expand runtime governor inputs to record live provider quota balances where the provider exposes them.
3. Prove full tool catalog installation on a clean machine and archive `tool-preflight.json`.
4. Run a real long lab once clean-machine tools and service-manager supervision are proven.
