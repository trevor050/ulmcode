# Decision: Model-Aware Runtime Governor

## What Was Researched

- OpenCode Go currently exposes models through the `opencode-go/<model-id>` provider route and publishes subscription/usage-limit behavior separately from raw model metadata.
- ChatGPT Pro currently grants higher ChatGPT and Codex allowances, but the help center explicitly frames access as subscription usage, not a permission to programmatically extract or resell capacity.
- OpenHands-style agent systems separate runtime/control state from the model transcript so long tasks survive context churn.

## Adopted

- Use provider model metadata (`limit.context`, `limit.output`, `cost`, cache cost, and over-200k price tiers) instead of hardcoded context assumptions.
- Preserve session and descendant subagent cost rollups through `Session.cost` and expose them in the TUI/API.
- Run pre-stream context estimation against the selected model and trigger compaction before oversized prompts hit provider APIs.
- Record long-run cost, token, compaction, repeated-fetch, background-task, and blind-spot state through `runtime_summary`.
- `operation_governor` reads the durable operation graph and runtime summary before new work starts, resolves lane model routes through a runtime catalog, then returns `continue`, `compact`, or `stop` with model route, context/output limits, context ratio, remaining budget, lane budget, cost-cliff blockers, and recovery tools.
- Background `task` launches now receive the lane `modelRoute` as a real model override instead of burying it only inside prompt text. Runtime rollups also keep `byLane` spend so shared agents such as `validator` do not smear one lane's budget across another lane.
- Operation lanes now include fallback model routes, and governor decisions expose them when quota, budget, or context pressure blocks the primary route.
- Subscription and API routes can carry explicit quota metadata. Hard quota exhaustion stops a lane before relaunch; soft quota pressure triggers compaction/replanning instead of blindly spending the same route all night.
- `operation_governor` now writes `deliverables/model-route-audit.json` and `.md` when an operation graph exists. The audit records primary and fallback route availability against the provider model list, runtime metadata coverage, provider kind, and whether a quota policy is known for each route.
- Route the isolated profile toward GPT-5.5 Fast for primary reasoning and GPT-5.4 Mini Fast for small lanes, while keeping OpenCode Go/open-model lanes available for throughput/fallback.

## Rejected

- A universal context threshold. It fails as soon as Go, OpenAI, local, and compatibility providers expose different windows or pricing cliffs.
- Treating ChatGPT Pro as an unlimited automation backend. The product terms and usage-limit model make that brittle and possibly noncompliant.
- Hiding cost behind "subscription" language. For 20-hour runs, request budgets and observed runtime state still matter.
- Ignoring route call counts or route availability. A daemon that keeps relaunching an exhausted or unavailable route is stuck, not autonomous.

## Implementation Anchors

- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/v2/model.ts`
- `packages/opencode/src/tool/runtime_summary.ts`
- `packages/opencode/src/tool/operation_governor.ts`
- `packages/opencode/src/ulm/model-runtime-catalog.ts`
- `packages/opencode/src/ulm/runtime-governor.ts`
- `packages/opencode/src/tool/task.ts`
- `tools/ulmcode-profile/opencode.json`
