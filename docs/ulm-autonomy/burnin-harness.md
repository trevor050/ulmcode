# Accelerated Burn-In Harness

The burn-in harness gives the 20+ hour autonomy work a deterministic proof artifact without waiting for 20 real hours.

## Command

```bash
bun run packages/opencode/script/ulm-burnin.ts <operationID> --target-hours 20 --tick-seconds 900 --json
```

Use `--max-ticks <n>` to intentionally stop early and leave a resume checkpoint. A later run with the same operation ID resumes from `.ulmcode/operations/<operation>/burnin/burnin-checkpoint.json`.

## Proof Contract

Each run writes:

- `burnin-proof.json`: required audit proof with `elapsedTargetSeconds`, `simulatedElapsedSeconds`, `ticks`, heartbeat counts, restart count, and `auditStatus`.
- `burnin-checkpoint.json`: restart/resume state.
- `daemon-heartbeat.json`: latest simulated daemon heartbeat.
- `scheduler-heartbeat.json`: latest simulated scheduler heartbeat.
- `burnin-heartbeats.jsonl`: complete daemon/scheduler heartbeat stream.
- `burnin-audit.md`: human-readable audit summary.

The audit passes only when simulated elapsed seconds reaches the requested target, daemon heartbeats equal ticks, scheduler heartbeats equal ticks, and the checkpoint is marked complete.

## Overnight Supervisor Scenario

The harness also writes `burnin-supervisor-scenario.json` and embeds the same proof into `burnin-proof.json`.

The accelerated scenario proves:

- a 20-hour operation goal is created.
- a plan-plan and durable operation plan exist before broad execution.
- the operation graph includes a supervisor lane.
- a stale command lane is simulated and recovered on resume.
- tool inventory and runtime summary artifacts are written.
- goal completion is blocked until `deliverables/operation-audit.json` exists.
- final audit artifacts allow the operation goal to complete after the simulated overnight window.

This remains accelerated readiness evidence. It is not literal wall-clock proof; use `ulm:literal-run-readiness` against an actual daemon run for that.
