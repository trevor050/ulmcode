# ULMCode Profile

This profile is the distributable ULMCode runtime layer for authorized K-12 security operations. It is intentionally smaller than a general OpenCode setup: ULMCode owns the operation ledger, findings, report quality tools, and core agents; external plugins are optional acceleration lanes.

## Install Locally

```sh
tools/ulmcode-profile/scripts/install-profile.sh
```

The installer writes `~/.config/ulmcode/opencode.json`, copies compact skills and ULM commands, installs the profile npm manifest, writes both root and `.opencode/` Oh My OpenAgent routing files, and creates `~/.config/ulmcode/ulmcode-launch.sh`.

## Runtime Defaults

- `pentest` is the default primary agent.
- `gpt-5.4-mini-fast` handles quick recon and evidence normalization.
- `gpt-5.5-fast` handles operation control, validation, reporting, and hard reasoning lanes.
- Skills are allowlisted to the bundled K-12 pentest profile.
- Playwright and pentest MCP are configured, with Vercel and Context7 present but disabled by default.
- The plugin stack mirrors the current local OpenCode setup: Oh My OpenAgent routing, the Claude Code bridge plugin, Playwright MCP, optional Vercel/Context7 MCP, and LAN LM Studio fallback models.
- The OMO profile preserves the user routing doctrine: 5.4 Mini Fast for quick/recon/docs/evidence lanes, GPT-5.5 high/xhigh for operation control, validation, report writing, and final review.
- Bundled commands include `ulm-resume`, `ulm-final-handoff`, and `ulm-test-plan`.
