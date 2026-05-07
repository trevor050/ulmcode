#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 -m json.tool "$PROFILE_DIR/opencode.json" >/dev/null
python3 -m json.tool "$PROFILE_DIR/package.json" >/dev/null
python3 -m json.tool "$PROFILE_DIR/oh-my-openagent.jsonc" >/dev/null
python3 -m json.tool "$PROFILE_DIR/tool-manifest.json" >/dev/null
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
grep -q 'ulmcode-runtime-guard.js' "$PROFILE_DIR/opencode.json"
grep -q '"k12-long-report-production": "allow"' "$PROFILE_DIR/opencode.json"
if grep -q 'oh-my-openagent' "$PROFILE_DIR/opencode.json" || grep -q 'oh-my-opencode' "$PROFILE_DIR/opencode.json"; then
  echo "profile must not load Oh My OpenAgent; ULMCode owns its native agent surface" >&2
  exit 1
fi
grep -q 'finalHandoff: true' "$PROFILE_DIR/commands/ulm-final-handoff.md"
grep -q '"defaultSafetyMode": "non_destructive"' "$PROFILE_DIR/tool-manifest.json"
grep -q '"destructiveSafetyMode": "interactive_destructive"' "$PROFILE_DIR/tool-manifest.json"
grep -q '"commandProfiles"' "$PROFILE_DIR/tool-manifest.json"
grep -q '"agent-browser"' "$PROFILE_DIR/tool-manifest.json"
grep -q '"action"' "$PROFILE_DIR/opencode.json"
grep -q '"websearch"' "$PROFILE_DIR/opencode.json"
grep -q 'web_search_exa' "$PROFILE_DIR/opencode.json"
if grep -q '"vercel"' "$PROFILE_DIR/opencode.json" || grep -q '"context7"' "$PROFILE_DIR/opencode.json"; then
  echo "profile must not include unrelated Vercel/context7 MCP servers" >&2
  exit 1
fi
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
sh -n "$PROFILE_DIR/scripts/install-profile.sh"
install_dir="$(mktemp -d)"
trap 'rm -rf "$install_dir"' EXIT
ULMCODE_CONFIG_DIR="$install_dir" "$PROFILE_DIR/scripts/install-profile.sh" >/dev/null
test -f "$install_dir/opencode.json"
test -f "$install_dir/plugins/ulmcode-runtime-guard.js"
test -f "$install_dir/plugins/vendor/opencode-claude-code-plugin-0.2.2/package.json"
test -f "$install_dir/plugins/vendor/oh-my-openagent-3.17.12/package.json"
grep -q 'file:plugins/vendor/oh-my-openagent-3.17.12' "$install_dir/package.json"
test -f "$install_dir/tool-manifest.json"
grep -q '"commandProfiles"' "$install_dir/tool-manifest.json"
grep -q '"action"' "$install_dir/opencode.json"
grep -q '"websearch"' "$install_dir/opencode.json"
test -f "$install_dir/commands/ulm-resume.md"
if [ -e "$install_dir/.opencode/agents" ] || [ -e "$install_dir/.opencode/prompts" ] || [ -e "$install_dir/.opencode/commands" ]; then
  echo "profile installer must not copy personal/general OpenCode agents, prompts, or commands" >&2
  exit 1
fi
if [ -e "$install_dir/oh-my-openagent.jsonc" ] || [ -e "$install_dir/.opencode/oh-my-openagent.jsonc" ]; then
  echo "profile installer must not install Oh My OpenAgent config files" >&2
  exit 1
fi
sh -n "$install_dir/ulmcode-launch.sh"
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lifecycle-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-smoke >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-tui-launch-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-tui-launch -- --timeout-ms=15000 >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-profile-skills.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-skills >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-tool-manifest.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-tool-manifest >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lab-replay.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-lab >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lab-target-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-lab-target >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-rebuild-audit.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-rebuild-audit >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-harness-run.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-harness:fast >/dev/null)
