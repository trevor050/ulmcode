# ULM Overnight Supervisor

Last reviewed: 2026-05-06

## Problem

ULMCode needs to run authorized K-12 security work for 20-36 hours without relying on a single chat context to remember the plan. The failure mode is not just model quality; it is missing runtime structure. Long scans, compaction, stale subagents, missing local tools, and final-report drift all need durable state and a supervisor loop.

## Architecture

- `operation_goal` stores the objective, target duration, continuation policy, and final completion blockers.
- `operation_plan` remains the durable plan of record. For long work, use plan-plan, discovery, Plannotator critique, then the full operation plan.
- `operation_schedule` writes the lane graph. Long operations need a supervisor lane plus bounded recon, validation, evidence, report, and handoff lanes.
- `runtime_scheduler` is the short-cycle owner. It syncs background jobs, requeues stale command work, runs supervisor review on cadence, respects blockers, runs `operation_run`, and launches model/command lanes.
- `runtime_daemon` is the wall-clock owner. It keeps the scheduler alive for the requested runtime, writes daemon heartbeats, recovers stale jobs, and can detach or generate launchd/systemd artifacts.
- `operation_supervise` is the watchdog. It can continue, ask for a question, recover, schedule, queue validation work, compact, pause, block, or mark handoff ready.
- The session loop runs a `turn_end` supervisor review before an active ULM operation is allowed to go idle. If execution or reporting is not complete, the loop writes a supervisor artifact and injects a synthetic continuation that names the required next tool.

## Duration-Aware Planning

- Under 2 hours: compact plan, then execute.
- 2-8 hours: plan-plan, bounded discovery, then full plan.
- 8-20 hours: staged discovery, supervisor checkpoints, and explicit recovery cadence.
- 20-36 hours: overnight plan with supervisor handoff, runtime daemon strategy, command profile plan, report closeout, and literal readiness path.
- Over 36 hours: require explicit operator confirmation.

## Command Policy

Never run a foreground command expected to exceed two minutes. Use `command_supervise`, `task` with `background=true`, `runtime_scheduler`, or `runtime_daemon`. The command can keep running; the main model should not sit blocked on it.

## Tool Inventory

Run `tool_inventory` early. It writes installed/missing tool facts and acquisition guidance under `.ulmcode/operations/<id>/tool-inventory/`. Use `tool_acquire` only after operator authorization, and keep unattended command profiles non-destructive.

## OMO And Plannotator

Oh My OpenAgent is the profile base for routing and delegation. Keep `sisyphus_agent.replace_plan=false`; native Build/Plan and ULM artifacts stay authoritative.

Plannotator is a critique lane, not the plan owner. For 8+ hour operations, run it after the plan-plan and before final `operation_plan` approval to find missing questions, lane gaps, report gaps, and ROE/safety issues.

## Completion Gates

Do not mark the operation complete until these artifacts exist and parse:

- `deliverables/runtime-summary.json`
- `deliverables/final/manifest.json`
- `deliverables/stage-gates/handoff.json`
- `deliverables/operation-audit.json`

Final reporting should run report writer, report reviewer, `report_lint`, `report_render`, `runtime_summary`, `eval_scorecard`, then `operation_audit`.
Use `eval_scorecard` to keep the result objectively scored for target, sandbox, success criteria, MITRE tags, validated findings, false positives, tool failures, retries, cost, and report quality.

## Unattended Operator Fallback

During active unattended operations, permission and question prompts wait for the operator for 75 seconds by default. Permission prompts never auto-approve; timeout rejects with corrective feedback and records an artifact under `operator-timeouts/`. Question prompts answer conservatively, preferring denial/unavailable choices for authorization, credential, scope, destructive, privacy, or install questions.

## Operator Commands

```bash
bun run --cwd packages/opencode ulm:runtime-daemon <operationID> --duration-hours 20 --json
bun run --cwd packages/opencode ulm:runtime-daemon <operationID> --duration-hours 20 --detach --json
bun run --cwd packages/opencode ulm:runtime-daemon <operationID> --supervisor all --json
opencode ulm status <operationID>
opencode ulm resume <operationID> --stale-after-minutes 30
opencode ulm audit <operationID> --format json
bun run --cwd packages/opencode ulm:burnin <operationID> --target-hours 20 --json
bun run --cwd packages/opencode ulm:literal-run-readiness <operationID> --strict --json
```

Burn-in is accelerated readiness proof. Literal readiness requires actual daemon wall-clock proof.
