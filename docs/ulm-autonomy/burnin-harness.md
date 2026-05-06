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
