# ULMCode Isolated Skill Profile

This package installs a strict ULM-only runtime configuration in the ULMCode app config directory for district pentest workflows.

## What it enforces
- Dedicated ULM config dir (`~/.config/ulmcode` by default)
- Only compact K-12 skills are loaded
- Skill permission policy is deny-by-default
- External and project skill discovery disabled at runtime

## Bootstrap

```bash
./tools/ulmcode-profile/scripts/bootstrap-ulmcode-profile.sh
```

Optional: include standalone `pdf` skill:

```bash
WITH_PDF=1 ./tools/ulmcode-profile/scripts/bootstrap-ulmcode-profile.sh
```

## Validate isolation

```bash
./tools/ulmcode-profile/scripts/check-ulmcode-skill-isolation.sh
```

## Run with isolation

```bash
~/.config/ulmcode/ulmcode-launch.sh
```

This launcher sets:
- `OPENCODE_CONFIG_DIR=~/.config/ulmcode`
- `OPENCODE_CONFIG=~/.config/ulmcode/opencode.json`
- `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`
- `OPENCODE_DISABLE_PROJECT_CONFIG=1`

## Compact skill set
- `k12-engagement-safety-and-change-control`
- `k12-recon-and-infrastructure-testing`
- `k12-identity-and-privilege-escalation`
- `k12-risk-mapping-and-reporting`
- `k12-agent-orchestration-and-quality`
