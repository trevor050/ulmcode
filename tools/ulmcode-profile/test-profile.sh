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
grep -q '"backend-architect"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q '"frontend-builder"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q '"product-taste-pass"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q '"background_task"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q 'finalHandoff: true' "$PROFILE_DIR/commands/ulm-final-handoff.md"
test -f "$PROFILE_DIR/local-opencode/.opencode/agents/backend-architect.md"
test -f "$PROFILE_DIR/local-opencode/.opencode/agents/verification-court.md"
test -f "$PROFILE_DIR/local-opencode/.opencode/prompts/sisyphus-routing.md"
test -f "$PROFILE_DIR/local-opencode/.opencode/commands/feature-forge.md"
test -f "$PROFILE_DIR/local-opencode/root/commands/ship.md"
grep -q 'Feature Forge' "$PROFILE_DIR/local-opencode/.opencode/commands/feature-forge.md"
grep -q 'GPT-5.5 backend architect' "$PROFILE_DIR/local-opencode/.opencode/agents/backend-architect.md"
sh -n "$PROFILE_DIR/scripts/install-profile.sh"
install_dir="$(mktemp -d)"
trap 'rm -rf "$install_dir"' EXIT
ULMCODE_CONFIG_DIR="$install_dir" "$PROFILE_DIR/scripts/install-profile.sh" >/dev/null
test -f "$install_dir/opencode.json"
test -f "$install_dir/commands/ulm-resume.md"
test -f "$install_dir/commands/ship.md"
test -f "$install_dir/.opencode/agents/backend-architect.md"
test -f "$install_dir/.opencode/prompts/sisyphus-routing.md"
test -f "$install_dir/.opencode/commands/feature-forge.md"
sh -n "$install_dir/ulmcode-launch.sh"
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lifecycle-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-smoke >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-profile-skills.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-skills >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lab-replay.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-lab >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lab-target-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-lab-target >/dev/null)
