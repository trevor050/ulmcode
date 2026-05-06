# ULMCode Autonomy Architecture Hub

Last reviewed: 2026-05-05

This directory is the decision hub for the long-running ULMCode autonomy work. The executable implementation lives in:

- `docs/ulm-autonomy/completion-audit.md` for the current prompt-to-artifact checklist and explicit remaining gaps. It is the anti-bullshit file: green harnesses are not accepted as completion by themselves.
- `packages/opencode/src/ulm/artifact.ts` for durable operation state, evidence, findings, reports, runtime summaries, gates, and audits.
- `packages/opencode/src/tool/operation_*.ts`, `runtime_summary.ts`, `report_lint.ts`, and `report_render.ts` for model-callable operation controls.
- `packages/opencode/src/tool/task.ts`, `task_status.ts`, `task_list.ts`, and `task_restart.ts` for background subagent lanes.
- `tools/ulmcode-profile/` for the isolated long-run profile, model routing, guard plugin, skills, commands, and tool manifest.
- `tools/ulmcode-evals/` and `tools/ulmcode-labs/` for deterministic harness scenarios and local lab replay targets.

## Research Inputs

- OpenCode Go: current docs describe a beta provider using `opencode-go/<model-id>`, subscription pricing, usage limits, and top-up behavior. The implementation treats Go routes as useful throughput lanes, not an unlimited context/cost blank check. Source: <https://opencode.ai/docs/go/>
- ChatGPT Pro and Codex: current OpenAI help material frames Pro tiers as higher-allowance ChatGPT/Codex access, not API-equivalent unmetered automation. Codex usage varies with task size, long-running context, execution location, and optional credits beyond plan limits. ULMCode should use Pro routes for hard reasoning, synthesis, and review while still recording budgets, quotas, runtime state, and fallback routes. Sources: <https://help.openai.com/en/articles/9793128-what-is-c>, <https://help.openai.com/en/articles/11369540-codex-in-chatgpt>, and <https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-freegopluspro>
- OpenHands: its evaluation harness and control-plane docs reinforce a split between harness, runtime, controller, policy, budgets, routing, and observable artifacts. Sources: <https://docs.openhands.dev/openhands/usage/developers/evaluation-harness>, <https://docs.openhands.dev/usage/architecture/runtime>, and <https://openhands.dev/blog/agent-control-plane>
- PentestGPT/PentAGI-style systems: their useful pattern is the reasoning/generation/parsing split plus lab replay, not unsupervised destructive testing. Source: <https://pentestgpt.com/>

## Decisions

- Use durable operation artifacts instead of context-only plans.
- Default unattended work to `non_destructive`; require `interactive_destructive` for destructive steps.
- Treat model limits, costs, and cache behavior as provider/model metadata and runtime measurements.
- Run long work through restartable background lanes with checkpoints, stale detection, and recovery metadata.
- Store evidence before findings; keep unverified leads separate from validated/report-ready findings.
- Require report lint, render, runtime summary, and operation audit before final handoff.
- Keep harness tiers named and runnable: `fast`, `full`, `chaos`, and `overnight`.

## Verification

Primary gates:

- `bun run --cwd packages/opencode typecheck`
- `bun run --cwd packages/opencode test:ulm-smoke`
- `bun run --cwd packages/opencode test:ulm-lab`
- `bun run --cwd packages/opencode test:ulm-lab-target`
- `bun run --cwd packages/opencode test:ulm-tool-manifest`
- `bun run --cwd packages/opencode test:ulm-harness:fast`
- `bun run --cwd packages/opencode test:ulm-harness:full`
- `bun run --cwd packages/opencode test:ulm-harness:chaos`
- `bun run --cwd packages/opencode test:ulm-harness:overnight`
- `bun run --cwd packages/opencode test:ulm-rebuild-audit`
- `tools/ulmcode-profile/test-profile.sh`
- `bun run lint`
