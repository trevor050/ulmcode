# ULMCode Profile

This profile is the distributable ULMCode runtime layer for authorized K-12 security operations. It is intentionally smaller than a general OpenCode setup: ULMCode owns the operation ledger, findings, report quality tools, and core agents; external plugins are optional acceleration lanes.

## Install Locally

```sh
tools/ulmcode-profile/scripts/install-profile.sh
```

The installer writes `~/.config/ulmcode/opencode.json`, copies compact skills, ULM commands, vendored profile plugins, installs the profile npm manifest, removes stale Oh My OpenAgent config files, and creates `~/.config/ulmcode/ulmcode-launch.sh`.

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
- The plugin stack is intentionally small: the ULM runtime guard, the Claude Code bridge plugin, Agent Browser MCP, Playwright MCP, pentest MCP, and LAN LM Studio fallback models.
- The profile includes a local `ulmcode-runtime-guard` server plugin that injects ULM operation-resume, background-task, report-lint, runtime-summary, and final-handoff guardrails into the runtime without depending on npm availability. It also bundles the local shell non-interactive strategy as a profile instruction so long unattended runs avoid prompt-prone shell commands.
- Third-party plugin source is vendored for audit/fork work under `plugins/vendor/`; currently this includes `@khalilgharbaoui/opencode-claude-code-plugin@0.2.2` and `oh-my-openagent@3.17.12`. Oh My OpenAgent is not loaded by the ULMCode profile; the vendored copy is retained only for future audit/fork work.
- Bundled commands include `ulm-resume`, `ulm-final-handoff`, and `ulm-test-plan`. General personal OpenCode agents, prompts, Feature Forge, and Sisyphus/OpenCode-Builder surfaces must stay out of the installed ULM profile.

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
