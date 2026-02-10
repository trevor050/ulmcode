#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="${1:-$HOME/.config/ulmcode}"
WITH_PDF="${WITH_PDF:-0}"
WITH_DEFENSIVE="${WITH_DEFENSIVE:-1}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PENTEST_SKILLS_SRC="$ROOT_DIR/skills/pentest-compact"
PENTEST_SKILLS_DST="$PROFILE_DIR/skills/pentest-compact"
DEFENSIVE_SKILLS_SRC="$ROOT_DIR/skills/defensive-compact"
DEFENSIVE_SKILLS_DST="$PROFILE_DIR/skills/defensive-compact"
CONFIG_FILE="$PROFILE_DIR/opencode.json"
LAUNCHER_FILE="$PROFILE_DIR/ulmcode-launch.sh"

if [[ ! -d "$PENTEST_SKILLS_SRC" ]]; then
  echo "[error] missing skills source: $PENTEST_SKILLS_SRC" >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR/skills"
rm -rf "$PENTEST_SKILLS_DST"
cp -R "$PENTEST_SKILLS_SRC" "$PENTEST_SKILLS_DST"

if [[ "$WITH_DEFENSIVE" == "1" ]]; then
  if [[ ! -d "$DEFENSIVE_SKILLS_SRC" ]]; then
    echo "[error] missing defensive skills source: $DEFENSIVE_SKILLS_SRC" >&2
    exit 1
  fi
  rm -rf "$DEFENSIVE_SKILLS_DST"
  cp -R "$DEFENSIVE_SKILLS_SRC" "$DEFENSIVE_SKILLS_DST"
fi

# Optional standalone pdf skill for report-heavy workflows.
if [[ "$WITH_PDF" == "1" ]]; then
  mkdir -p "$PROFILE_DIR/skills/pdf"
  cp -R "$HOME/.config/opencode/skill/pdf/." "$PROFILE_DIR/skills/pdf/" 2>/dev/null || true
fi

python3 - <<'PY' "$CONFIG_FILE" "$PROFILE_DIR" "$WITH_PDF" "$WITH_DEFENSIVE"
import json, pathlib, re, sys
config_file = pathlib.Path(sys.argv[1])
profile_dir = pathlib.Path(sys.argv[2])
with_pdf = sys.argv[3] == '1'
with_defensive = sys.argv[4] == '1'
skill_roots = [profile_dir / 'skills' / 'pentest-compact']
if with_defensive:
    skill_roots.append(profile_dir / 'skills' / 'defensive-compact')

skill_names = []
for skill_root in skill_roots:
    for p in sorted(skill_root.rglob('SKILL.md')):
        t = p.read_text(errors='ignore')
        m = re.search(r'^name:\s*(.+)$', t, re.M)
        if not m:
            continue
        n = m.group(1).strip().strip('"')
        if n not in skill_names:
            skill_names.append(n)
if with_pdf:
    skill_names.append('pdf')

cfg = {
  "$schema": "https://opencode.ai/config.json",
  "skills": {
    "paths": [str(root) for root in skill_roots] + ([str(profile_dir / 'skills' / 'pdf')] if with_pdf else [])
  },
  "permission": {
    "skill": {
      "*": "deny",
      **{name: "allow" for name in skill_names}
    }
  },
  "mcp": {
    "vercel": {"type": "remote", "url": "https://mcp.vercel.com"},
    "context7": {"type": "remote", "url": "https://mcp.context7.com/mcp"},
    "playwright": {"type": "local", "command": ["npx", "@playwright/mcp@latest"]},
    "pentestMCP": {"type": "local", "command": ["docker", "run", "--rm", "-i", "ramgameer/pentest-mcp:latest"]}
  }
}
config_file.write_text(json.dumps(cfg, indent=2) + "\n")
print("[ok] wrote", config_file)
print("[ok] allowlisted skills:")
for name in skill_names:
    print(" -", name)
PY

cat > "$LAUNCHER_FILE" <<'LAUNCH'
#!/usr/bin/env bash
set -euo pipefail
PROFILE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

export OPENCODE_CONFIG_DIR="$PROFILE_DIR"
export OPENCODE_CONFIG="$PROFILE_DIR/opencode.json"
export OPENCODE_DISABLE_EXTERNAL_SKILLS=1
export OPENCODE_DISABLE_PROJECT_CONFIG=1

# Run ULMCode if available; fallback to opencode.
if command -v ulmcode >/dev/null 2>&1; then
  exec ulmcode "$@"
fi
exec opencode "$@"
LAUNCH
chmod +x "$LAUNCHER_FILE"

cat > "$PROFILE_DIR/AGENTS.md" <<'AG'
# ULMCode Isolated Profile

This profile is strict-isolation mode for district pentest operations.

## Required runtime flags
- OPENCODE_CONFIG_DIR=<this profile dir>
- OPENCODE_CONFIG=<this profile dir>/opencode.json
- OPENCODE_DISABLE_EXTERNAL_SKILLS=1
- OPENCODE_DISABLE_PROJECT_CONFIG=1

## Skill policy
- deny by default
- allow only compact k12 skill set (and optional pdf if enabled)
- load the matching skill and `references/*.md` before specialized execution:
  - AD/Kerberos/domain abuse -> k12-identity-and-privilege-escalation + active-directory-attacks
  - Windows/Linux privesc -> k12-identity-and-privilege-escalation + OS-specific privesc reference
  - SSH/SMTP/Shodan/packet analysis -> k12-recon-and-infrastructure-testing + protocol/tool reference
  - ROE/scope/change-control -> k12-engagement-safety-and-change-control + safety reference
  - FERPA/privacy/report packaging/PDF -> k12-risk-mapping-and-reporting + reporting/compliance/pdf reference
  - multi-agent handoff/quality -> k12-agent-orchestration-and-quality + session-handoff/agent-evaluation
  - baseline/hardening -> k12-hardening-baseline + windows/linux/mfa checklists
  - compliance mapping -> k12-compliance-mapping + FERPA/CIS/evidence references
  - detection engineering -> k12-detection-engineering + coverage/triage/log-source references
  - incident response -> k12-incident-response + IR/artifacts/chain-of-custody references
  - phishing defense -> k12-phishing-defense + campaign/email-auth/awareness references

## Operational note
Use this profile launcher for field engagements to prevent skill leakage from shared environments.
AG

echo "[ok] profile bootstrapped at $PROFILE_DIR"
echo "[next] run: $LAUNCHER_FILE"
