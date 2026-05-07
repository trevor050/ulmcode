#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="${ULMCODE_CONFIG_DIR:-"$HOME/.config/ulmcode"}"

mkdir -p "$TARGET_DIR"
mkdir -p "$TARGET_DIR/.opencode"
rm -rf "$TARGET_DIR/skills"
rm -rf "$TARGET_DIR/commands"
rm -rf "$TARGET_DIR/plugins"
rm -rf "$TARGET_DIR/.opencode/agents"
rm -rf "$TARGET_DIR/.opencode/prompts"
rm -rf "$TARGET_DIR/.opencode/commands"
rm -f "$TARGET_DIR/oh-my-openagent.jsonc"
rm -f "$TARGET_DIR/oh-my-opencode.jsonc"
rm -f "$TARGET_DIR/.opencode/oh-my-openagent.jsonc"
rm -f "$TARGET_DIR/.opencode/oh-my-opencode.jsonc"
cp -R "$PROFILE_DIR/skills" "$TARGET_DIR/skills"
cp -R "$PROFILE_DIR/commands" "$TARGET_DIR/commands"
cp -R "$PROFILE_DIR/plugins" "$TARGET_DIR/plugins"
cp "$PROFILE_DIR/package.json" "$TARGET_DIR/package.json"
cp "$PROFILE_DIR/tool-manifest.json" "$TARGET_DIR/tool-manifest.json"
sed "s#__ULMCODE_PROFILE_DIR__#$TARGET_DIR#g" "$PROFILE_DIR/opencode.json" > "$TARGET_DIR/opencode.json"
cp "$TARGET_DIR/opencode.json" "$TARGET_DIR/ulmcode.json"

cat > "$TARGET_DIR/ulmcode-launch.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

export OPENCODE_APP_NAME="${OPENCODE_APP_NAME:-ulmcode}"
export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-"$HOME/.config/ulmcode"}"
export OPENCODE_CONFIG="${OPENCODE_CONFIG:-"$OPENCODE_CONFIG_DIR/opencode.json"}"
export OPENCODE_DISABLE_PROJECT_CONFIG="${OPENCODE_DISABLE_PROJECT_CONFIG:-1}"
export OPENCODE_MCP_ALLOWLIST="${OPENCODE_MCP_ALLOWLIST:-websearch,agent_browser,playwright,pentestMCP}"
export OMO_DISABLE_POSTHOG="${OMO_DISABLE_POSTHOG:-1}"

if command -v ulmcode >/dev/null 2>&1; then
  exec ulmcode "$@"
fi

exec opencode "$@"
SH

chmod +x "$TARGET_DIR/ulmcode-launch.sh"
printf 'Installed ULMCode profile at %s\n' "$TARGET_DIR"
