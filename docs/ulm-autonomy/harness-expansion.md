# Decision: Harness Expansion

## What Was Researched

- OpenHands evals separate scenarios, runtime execution, and output scorecards.
- Local pentest labs give deterministic coverage without pretending every run should hit live targets.
- Chaos checks should validate restart, provider/tool failure, stale lanes, and report quality failures as first-class risks.

## Adopted

- `tools/ulmcode-evals/scenarios/` stores named scenario manifests for the ten long-run capability gaps.
- `packages/opencode/src/ulm/harness.ts` defines required capabilities and scorecard output.
- `packages/opencode/script/ulm-harness-run.ts` exposes `fast`, `full`, `chaos`, and `overnight` tiers.
- `tools/ulmcode-labs/` provides replayable local K-12 security scenarios, including chained and authored-report cases.
- Scorecards write durable JSON and markdown under `packages/opencode/.artifacts/ulm-harness/`.

## Rejected

- A single "tests pass" proxy for long-run readiness. The harness needs named capability coverage.
- Hidden one-off manual drills. They are useful only when they become reproducible scenarios or documented opt-in runs.
- Making the overnight gate literally sleep for 20 hours in default CI. The default gate checks readiness contracts; real long lab operation should be explicit.

## Implementation Anchors

- `packages/opencode/src/ulm/harness.ts`
- `packages/opencode/script/ulm-harness-run.ts`
- `packages/opencode/script/ulm-lifecycle-smoke.ts`
- `packages/opencode/script/ulm-lab-replay-all.ts`
- `packages/opencode/script/ulm-lab-target-smoke.ts`
- `tools/ulmcode-evals/scenarios/`
- `tools/ulmcode-labs/`
