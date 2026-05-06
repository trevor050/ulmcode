# Decision: Overnight Operation Engine

## What Was Researched

- OpenHands and similar coding-agent harnesses keep runtime, event history, and evaluation output outside the model context.
- PentestGPT-style architectures split planning, execution, and parsing, which maps cleanly to ULMCode phases and background lanes.
- Long-running agent systems need restart briefs, stale-task detection, and stage gates more than they need giant prompts.
- Apple's launchd guidance uses `ProgramArguments`, `KeepAlive`, `WorkingDirectory`, `StandardOutPath`, and `StandardErrorPath` for managed jobs, and systemd's service docs define `Restart=on-failure` for failed processes, signals, timeouts, and watchdog failures.

## Adopted

- `.ulmcode/operations/<operation-id>/` is the canonical operation root.
- `operation_plan` records ordered phases, actions, success criteria, subagent/no-subagent policy, assumptions, and reporting closeout.
- `operation_schedule` records the required lane graph: recon, web inventory, identity/auth, SaaS/cloud, evidence normalization, finding validation, report writing, report review, and operator summary.
- `operation_next` turns that graph into the next persisted launch/wait/compact/stop decision, respecting dependency completion, max concurrency, runtime budget, and context pressure.
- `operation_run` mutates lane lifecycle state, writes `operation-run.jsonl`, marks launchable lanes as running, can immediately launch the selected model lane with `launchModelLane=true`, records completion/failure, syncs background jobs with `laneID` metadata, and only auto-completes lanes when a lane-completion proof references real non-empty operation artifacts.
- `operation_queue` and `operation_queue_next` convert normalized leads into durable command work units and return exact `command_supervise` params without storing raw shell in the queue. `operation_run` reconciles returned `workUnitID` metadata from background jobs so the queue survives restarts with completed and failed unit state.
- `runtime_scheduler` is the per-cycle unattended owner loop. It requeues claimed work units that never bound to a command job, syncs background jobs, advances `operation_run`, evaluates the governor, and writes scheduler heartbeats/logs for resume.
- `runtime_scheduler` can launch prepared model lanes through an injected owner hook, so tool-backed scheduler/daemon runs create background `task` jobs instead of only mutating graph state. It also claims queued command work units and launches them through `command_supervise` with `dryRun:false`, preserving `workUnitID` so queue state is reconciled by later scheduler cycles.
- `ulm:runtime-daemon` runs the scheduler as a wall-clock owner for real long operations. It has a 20-hour default runtime window, interval sleeps, an operation-scoped daemon lock, stale-lock recovery, stale-job recovery hooks, signal-aware shutdown, daemon heartbeats, and JSONL logs. Operators can launch it with `--detach --json` to get a pid plus launch, heartbeat, process-log, and scheduler-log paths while the run continues in the background.
- `ulm:runtime-daemon <operationID> --supervisor all --json` writes launchd and systemd user-service artifacts plus `supervisor-install.md` and `supervisor-manifest.json`. These service-manager files run the foreground daemon command, not `--detach`, because launchd/systemd should own restart policy, stdio, and process lifetime.
- `ulm:literal-run-readiness <operationID> --strict --json` writes `scheduler/literal-run-readiness.json` and `.md` and separates setup readiness from literal wall-clock proof. Accelerated burn-in and service-manager files count as readiness evidence only; the strict audit passes only when the daemon heartbeat and JSONL log prove the target elapsed runtime and the final daemon heartbeat records useful work such as model-lane launches, command launches, lane completions, synced jobs, or recoveries.
- `operation_checkpoint`, `operation_status`, `operation_resume`, `operation_recover`, `operation_stage_gate`, and `operation_audit` form the durable control loop.
- Unattended execution defaults to `non_destructive`; destructive work is represented as `interactive_destructive` and must happen with a human present.
- `operation_resume` can recover stale restartable background lanes before returning the updated brief.
- A real 20-hour run can be launched through `ulm:runtime-daemon --detach --json`, then audited through the emitted heartbeat/log paths plus `operation_status`, `runtime_summary`, and `operation_audit`.
- A more durable unattended run should install the generated launchd/systemd artifact from `--supervisor all`, then use the same heartbeat/log/runtime-summary/final-audit chain as evidence.
- A completed 20-hour claim should include the `ulm:literal-run-readiness --strict --json` result in the operator handoff so a later reviewer can distinguish "ready to run", "20-hour idle daemon", and "proved useful autonomy by wall clock."

## Rejected

- Prose-only plans. They are too easy to lose after compaction and too weak for 20-hour recovery.
- Automatic destructive escalation. ULMCode is for authorized operators, but unattended destructive testing is the wrong default.
- Treating chat todos as the operation ledger. Todos are useful UI state, but checkpoints and artifacts are the durable truth.
- Completing lanes from empty directories or broad path existence checks. Lanes now need explicit proof artifacts so final reports cannot mask an incomplete graph.

## Implementation Anchors

- `packages/opencode/src/tool/operation_plan.ts`
- `packages/opencode/src/tool/operation_schedule.ts`
- `packages/opencode/src/tool/operation_next.ts`
- `packages/opencode/src/tool/operation_run.ts`
- `packages/opencode/src/tool/operation_queue.ts`
- `packages/opencode/src/tool/operation_queue_next.ts`
- `packages/opencode/src/ulm/operation-graph.ts`
- `packages/opencode/src/ulm/operation-next.ts`
- `packages/opencode/src/ulm/operation-run.ts`
- `packages/opencode/src/ulm/runtime-daemon.ts`
- `packages/opencode/src/ulm/runtime-supervisor.ts`
- `packages/opencode/src/ulm/literal-run-readiness.ts`
- `packages/opencode/src/ulm/work-queue.ts`
- `packages/opencode/test/ulm/operation-run.test.ts`
- `packages/opencode/test/ulm/runtime-daemon.test.ts`
- `packages/opencode/test/ulm/work-queue.test.ts`
- `packages/opencode/src/tool/operation_resume.ts`
- `packages/opencode/src/tool/operation_recover.ts`
- `packages/opencode/src/tool/operation_stage_gate.ts`
- `packages/opencode/src/tool/operation_audit.ts`
- `packages/opencode/src/ulm/artifact.ts`

## Sources

- Apple Developer Archive, "Creating Launch Daemons and Agents": https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
- freedesktop.org, `systemd.service`: https://www.freedesktop.org/software/systemd/man/247/systemd.service.html
