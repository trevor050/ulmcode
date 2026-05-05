#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 -m json.tool "$PROFILE_DIR/opencode.json" >/dev/null
python3 -m json.tool "$PROFILE_DIR/package.json" >/dev/null
python3 -m json.tool "$PROFILE_DIR/oh-my-openagent.jsonc" >/dev/null
find "$PROFILE_DIR/skills" -name SKILL.md -print | sort | while read -r skill; do
  grep -q '^---$' "$skill"
  grep -q '^name:' "$skill"
  grep -q '^description:' "$skill"
done
grep -q '"@khalilgharbaoui/opencode-claude-code-plugin"' "$PROFILE_DIR/package.json"
grep -q '"oh-my-openagent"' "$PROFILE_DIR/package.json"
grep -q '"report-writer"' "$PROFILE_DIR/oh-my-openagent.jsonc"
sh -n "$PROFILE_DIR/scripts/install-profile.sh"
