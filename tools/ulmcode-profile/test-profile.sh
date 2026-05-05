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
grep -q 'file:plugins/vendor/oh-my-openagent-3.17.12' "$PROFILE_DIR/package.json"
grep -q '"report-writer"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q '"backend-architect"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q '"frontend-builder"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q '"product-taste-pass"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q '"background_task"' "$PROFILE_DIR/oh-my-openagent.jsonc"
grep -q 'ulmcode-runtime-guard.js' "$PROFILE_DIR/opencode.json"
grep -q '"k12-long-report-production": "allow"' "$PROFILE_DIR/opencode.json"
grep -q '"oh-my-openagent"' "$PROFILE_DIR/opencode.json"
if grep -q 'oh-my-openagent@latest' "$PROFILE_DIR/opencode.json"; then
  echo "profile must use vendored oh-my-openagent dependency, not @latest" >&2
  exit 1
fi
grep -q 'finalHandoff: true' "$PROFILE_DIR/commands/ulm-final-handoff.md"
test -f "$PROFILE_DIR/plugins/ulmcode-runtime-guard.js"
test -f "$PROFILE_DIR/plugins/vendor/opencode-claude-code-plugin-0.2.2/package.json"
grep -q '"@khalilgharbaoui/opencode-claude-code-plugin"' "$PROFILE_DIR/plugins/vendor/opencode-claude-code-plugin-0.2.2/package.json"
grep -q 'opencode-claude-code' "$PROFILE_DIR/plugins/vendor/opencode-claude-code-plugin-0.2.2/dist/index.js"
test -f "$PROFILE_DIR/plugins/vendor/oh-my-openagent-3.17.12/package.json"
test -f "$PROFILE_DIR/plugins/vendor/oh-my-openagent-3.17.12/dist/index.js"
test -f "$PROFILE_DIR/plugins/vendor/oh-my-openagent-3.17.12/dist/oh-my-opencode.schema.json"
grep -q '"name": "oh-my-openagent"' "$PROFILE_DIR/plugins/vendor/oh-my-openagent-3.17.12/package.json"
grep -q '"version": "3.17.12"' "$PROFILE_DIR/plugins/vendor/oh-my-openagent-3.17.12/package.json"
grep -q 'npm pack oh-my-openagent@3.17.12' "$PROFILE_DIR/plugins/vendor/oh-my-openagent-3.17.12/ULMCODE_VENDOR.md"
bun "$PROFILE_DIR/scripts/check-runtime-guard.mjs" "$PROFILE_DIR/plugins/ulmcode-runtime-guard.js" >/dev/null
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
test -f "$install_dir/plugins/ulmcode-runtime-guard.js"
test -f "$install_dir/plugins/vendor/opencode-claude-code-plugin-0.2.2/package.json"
test -f "$install_dir/plugins/vendor/oh-my-openagent-3.17.12/package.json"
grep -q 'file:plugins/vendor/oh-my-openagent-3.17.12' "$install_dir/package.json"
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
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-rebuild-audit.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-rebuild-audit >/dev/null)
