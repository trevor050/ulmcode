#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="${ULMCODE_CONFIG_DIR:-"$HOME/.config/ulmcode"}"

mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_DIR/skills"
cp -R "$PROFILE_DIR/skills" "$TARGET_DIR/skills"
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
