# ULMCode Profile

This profile is the distributable ULMCode runtime layer for authorized K-12 security operations. It is intentionally smaller than a general OpenCode setup: ULMCode owns the operation ledger, findings, report quality tools, and core agents; external plugins are optional acceleration lanes.

## Install Locally

```sh
tools/ulmcode-profile/scripts/install-profile.sh
```

The installer writes `~/.config/ulmcode/opencode.json`, copies compact skills, and creates `~/.config/ulmcode/ulmcode-launch.sh`.

## Runtime Defaults

- `pentest` is the default primary agent.
- `gpt-5.4-mini-fast` handles quick recon and evidence normalization.
- `gpt-5.5-fast` handles operation control, validation, reporting, and hard reasoning lanes.
- Skills are allowlisted to the bundled K-12 pentest profile.
- Playwright and pentest MCP are configured, with Vercel and Context7 present but disabled by default.
