# ULMCode Profile

This profile is the distributable ULMCode runtime layer for authorized K-12 security operations. It is intentionally smaller than a general OpenCode setup: ULMCode owns the operation ledger, findings, report quality tools, and core agents; external plugins are optional acceleration lanes.

## Install Locally

```sh
tools/ulmcode-profile/scripts/install-profile.sh
```

The installer writes `~/.config/ulmcode/opencode.json`, copies compact skills and ULM commands, installs the profile npm manifest, writes both root and `.opencode/` Oh My OpenAgent routing files, and creates `~/.config/ulmcode/ulmcode-launch.sh`.

`test-profile.sh` also runs the package-level ULM lifecycle smoke command, which creates a synthetic operation, records evidence/finding artifacts, renders final HTML/PDF/manifest outputs, writes a runtime summary, and requires final handoff lint to pass.

It also runs the bundled lab replay command against `tools/ulmcode-labs/k12-login-mfa-gap/manifest.json`, proving the manifest-driven replay harness can turn a lab scenario into final ULM artifacts.

## Runtime Defaults

- `pentest` is the default primary agent.
- `gpt-5.4-mini-fast` handles quick recon and evidence normalization.
- `gpt-5.5-fast` handles operation control, validation, reporting, and hard reasoning lanes.
- Skills are allowlisted to the bundled K-12 pentest profile.
- Playwright and pentest MCP are configured, with Vercel and Context7 present but disabled by default.
- The plugin stack mirrors the current local OpenCode setup: Oh My OpenAgent routing, the Claude Code bridge plugin, Playwright MCP, optional Vercel/Context7 MCP, and LAN LM Studio fallback models.
- The OMO profile preserves the user routing doctrine: 5.4 Mini Fast for quick/recon/docs/evidence lanes, GPT-5.5 high/xhigh for operation control, validation, report writing, and final review.
- Bundled commands include `ulm-resume`, `ulm-final-handoff`, and `ulm-test-plan`.
