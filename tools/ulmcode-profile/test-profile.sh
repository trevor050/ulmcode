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
find "$PROFILE_DIR/commands" -name '*.md' -print | sort | while read -r command; do
  grep -q '^---$' "$command"
  grep -q '^description:' "$command"
done
grep -q '"@khalilgharbaoui/opencode-claude-code-plugin"' "$PROFILE_DIR/package.json"
grep -q '"oh-my-openagent"' "$PROFILE_DIR/package.json"
grep -q '"report-writer"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q 'finalHandoff: true' "$PROFILE_DIR/commands/ulm-final-handoff.md"
sh -n "$PROFILE_DIR/scripts/install-profile.sh"
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lifecycle-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-smoke >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lab-replay.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-lab >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lab-target-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-lab-target >/dev/null)
