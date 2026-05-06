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
cp -R "$PROFILE_DIR/skills" "$TARGET_DIR/skills"
cp -R "$PROFILE_DIR/commands" "$TARGET_DIR/commands"
cp -R "$PROFILE_DIR/plugins" "$TARGET_DIR/plugins"
cp -R "$PROFILE_DIR/local-opencode/root/commands/." "$TARGET_DIR/commands/"
cp -R "$PROFILE_DIR/local-opencode/.opencode/agents" "$TARGET_DIR/.opencode/agents"
cp -R "$PROFILE_DIR/local-opencode/.opencode/prompts" "$TARGET_DIR/.opencode/prompts"
cp -R "$PROFILE_DIR/local-opencode/.opencode/commands" "$TARGET_DIR/.opencode/commands"
cp "$PROFILE_DIR/package.json" "$TARGET_DIR/package.json"
cp "$PROFILE_DIR/oh-my-openagent.jsonc" "$TARGET_DIR/oh-my-openagent.jsonc"
cp "$PROFILE_DIR/oh-my-openagent.jsonc" "$TARGET_DIR/.opencode/oh-my-openagent.jsonc"
cp "$PROFILE_DIR/tool-manifest.json" "$TARGET_DIR/tool-manifest.json"
sed "s#__ULMCODE_PROFILE_DIR__#$TARGET_DIR#g" "$PROFILE_DIR/opencode.json" > "$TARGET_DIR/opencode.json"

cat > "$TARGET_DIR/ulmcode-launch.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-"$HOME/.config/ulmcode"}"
export OPENCODE_CONFIG="${OPENCODE_CONFIG:-"$OPENCODE_CONFIG_DIR/opencode.json"}"
export OPENCODE_DISABLE_PROJECT_CONFIG="${OPENCODE_DISABLE_PROJECT_CONFIG:-1}"

if command -v ulmcode >/dev/null 2>&1; then
  exec ulmcode "$@"
fi

exec opencode "$@"
SH

chmod +x "$TARGET_DIR/ulmcode-launch.sh"
printf 'Installed ULMCode profile at %s\n' "$TARGET_DIR"
