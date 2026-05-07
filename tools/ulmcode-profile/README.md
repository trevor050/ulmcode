# ULMCode Profile

This profile is the distributable ULMCode runtime layer for authorized K-12 security operations. It is intentionally smaller than a general OpenCode setup: ULMCode owns the operation ledger, findings, report quality tools, and core agents; external plugins are optional acceleration lanes.

## Install Locally

```sh
tools/ulmcode-profile/scripts/install-profile.sh
```

The installer writes `~/.config/ulmcode/opencode.json`, copies compact skills, ULM commands, the vetted local OpenCode command set, the local OMO agents/prompts/Feature Forge command, vendored profile plugins, installs the profile npm manifest, writes both root and `.opencode/` Oh My OpenAgent routing files, and creates `~/.config/ulmcode/ulmcode-launch.sh`.

`test-profile.sh` also runs the package-level ULM lifecycle smoke command, which creates a synthetic operation, records evidence/finding artifacts, enforces the validation stage gate, renders final HTML/PDF/manifest outputs, writes a runtime summary and operation audit, and requires final handoff lint to pass.

The verifier also runs `bun run --cwd packages/opencode test:ulm-skills` so compact skills and commands stay discoverable, placeholder-free, wired to durable ULM tools, and guarded against model-routing drift.

It also runs the bundled lab replay catalog, proving the manifest-driven replay harness can turn each lab scenario into final ULM artifacts with validation stage gates, final handoff, report-budget lint, outline-section lint, and operation audit gates. The same verifier starts and probes the bundled lab target services, then runs `test:ulm-rebuild-audit` to check that the rebuild evidence checklist is still wired.

## Runtime Defaults

- `pentest` is the default primary agent.
- `gpt-5.4-mini-fast` handles quick recon and evidence normalization.
- `gpt-5.5-fast` handles operation control, attack-path mapping, validation, reporting, report review, and hard reasoning lanes.
- Session retries are capped with `max_retries: 8` so a long unattended operation can ride out transient provider failures without spinning forever.
- Skills are allowlisted to the bundled K-12 pentest profile, including a dedicated long-report production skill for dense report drafting and sparse-report prevention.
- Agent Browser, Playwright, and pentest MCP are configured. `agent_browser` is the preferred browser automation MCP; Playwright is the fallback.
- The plugin stack mirrors the current local ULMCode setup: Oh My OpenAgent routing from the vendored profile dependency, the Claude Code bridge plugin, Agent Browser MCP, Playwright MCP, and LAN LM Studio fallback models.
- The profile includes a local `ulmcode-runtime-guard` server plugin that injects ULM operation-resume, background-task, report-lint, runtime-summary, and final-handoff guardrails into the runtime without depending on npm availability. It also bundles the local shell non-interactive strategy as a profile instruction so long unattended runs avoid prompt-prone shell commands.
- Third-party plugin source is vendored for audit/fork work under `plugins/vendor/`; currently this includes `@khalilgharbaoui/opencode-claude-code-plugin@0.2.2` and `oh-my-openagent@3.17.12`. The profile npm manifest points OMO dependencies at the vendored package directory so installs are tied to the audited copy.
- The profile vendors the current local OMO markdown layer under `local-opencode/`: 12 agents, 16 prompts, Feature Forge, and 8 root commands. The installer copies those into the isolated ULMCode config so category routing and manual commands survive a fresh install.
- The OMO profile preserves the user routing doctrine: 5.4 Mini Fast for quick/recon/docs/evidence lanes, GPT-5.5 high/xhigh for operation control, validation, backend architecture/build, report writing, and final review; Kimi handles frontend taste/build; Gemini handles semantic product taste; Claude Sonnet is sparse human-feel review only.
- Plannotator is integrated as the optional `plan-critic` category, not as a replacement for native Build/Plan or the durable `operation_plan` tool. For 8+ hour operations, invoke it after the plan-plan and before the full operation plan is approved so it can flag missing questions, lane gaps, report gaps, and ROE/safety concerns. Disable it by omitting the `plan-critic` lane; keep `sisyphus_agent.replace_plan=false` so OMO augments native planning instead of owning the plan of record.
- Background-task concurrency, runtime fallback, auto-resume, aggressive truncation, and tmux layout settings are carried over from the current local OpenCode profile.
- Bundled commands include `ulm-resume`, `ulm-final-handoff`, `ulm-test-plan`, plus the useful local workflow commands `btw`, `commit-msg`, `explain-diff`, `frontend-polish`, `handoff`, `review`, `ship`, and `test-plan`.

## Overnight Operation Flow

Start long work by creating an operation goal, running `tool_inventory`, writing the duration-aware `operation_plan`, and scheduling lanes with `operation_schedule`. For a real overnight run, hand off to the daemon instead of keeping a foreground chat command alive:

```sh
bun run --cwd packages/opencode ulm:runtime-daemon <operationID> --duration-hours 20 --detach --json
```

Inspect and recover with:

```sh
opencode ulm status <operationID>
opencode ulm resume <operationID> --stale-after-minutes 30
opencode ulm audit <operationID> --format json
```

Use `runtime_scheduler` for short local cycles, `runtime_daemon` for wall-clock ownership, and `operation_supervise` whenever progress stalls, before compaction, and before final handoff.

Readiness commands:

```sh
bun run --cwd packages/opencode ulm:burnin <operationID> --target-hours 20 --json
bun run --cwd packages/opencode ulm:literal-run-readiness <operationID> --strict --json
```

Burn-in is accelerated readiness evidence. Literal readiness only passes with actual daemon heartbeat/log proof.
