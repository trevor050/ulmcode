# Decision: Tool Acquisition And Command Supervision

## What Was Researched

- OpenHands-style runtimes treat tool availability and runtime state as part of the harness, not just model memory.
- Pentest lab systems rely on reproducible tools, saved command output, and local targets.
- Current security tooling changes quickly, so ULMCode needs a manifest that can be revised without editing prompts every time a tool changes.

## Adopted

- `tools/ulmcode-profile/tool-manifest.json` is the tool-acquisition and supervised-command catalog.
- Each tool records install methods, validation command, safe examples, output parsers, safety classification, and fallback paths.
- Each command profile records heartbeat, idle timeout, hard timeout, restartability, expected artifacts, and safety mode.
- `tool_acquire` validates a required local tool, records blockers/fallbacks, and only installs when explicitly requested. Omitting `toolID` runs a clean-machine preflight across every manifest tool and writes `tools/tool-preflight.json` plus `.md`; the markdown includes a blocked install plan with validation command, install command, fallback path, and blocker text for every missing tool.
- Operators can run the same preflight outside a model turn with `bun run --cwd packages/opencode ulm:tool-preflight -- --worktree <repo-or-operation-worktree> --json`.
- `command_supervise` renders a vetted command profile, writes a durable command plan, and can launch it with heartbeat, idle timeout, hard timeout, stdout/stderr capture, and restartable background-job metadata. It preserves optional lane and work-unit metadata so `operation_run` can sync both lane state and queue state from background jobs.
- `operation_resume recoverStaleTasks=true` and `operation_recover` now recover both model lanes and supervised command jobs. Command recovery uses persisted profile ID, variables, output prefix, manifest path, lane ID, and work-unit ID rather than requiring the model to reconstruct shell by memory.
- `evidence_normalize` consumes command plans and expected artifacts after commands complete, preserving raw command support as evidence while emitting separate unverified leads.
- `bun run --cwd packages/opencode test:ulm-tool-manifest` validates the manifest structure and prevents unsafe unattended profile drift.
- Failed installs should be recorded as explicit blockers with fallback paths, not silently ignored.

## Rejected

- A hardcoded one-off tool list in prompts. It rots quickly and gives the model no validation or fallback contract.
- Unbounded foreground scans. Long scans belong in background lanes with heartbeat and artifact tracking.
- Default destructive scan profiles. They belong behind explicit `interactive_destructive` operation mode.
- Letting command output remain as disconnected log files. Long-running operations need the raw output plus normalized leads that survive compaction.

## Implementation Anchors

- `tools/ulmcode-profile/tool-manifest.json`
- `packages/opencode/src/tool/tool_acquire.ts`
- `packages/opencode/src/ulm/tool-acquisition.ts`
- `packages/opencode/src/tool/command_supervise.ts`
- `packages/opencode/src/tool/evidence_normalize.ts`
- `packages/opencode/src/ulm/evidence-normalizer.ts`
- `packages/opencode/src/ulm/tool-manifest.ts`
- `packages/opencode/script/ulm-tool-manifest.ts`
- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/tool/task_status.ts`
- `packages/opencode/src/tool/task_restart.ts`
- `packages/opencode/src/tool/operation_recover.ts`
