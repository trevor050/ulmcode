#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="${1:-$HOME/.config/ulmcode}"
CONFIG_FILE="$PROFILE_DIR/opencode.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[fail] missing profile config: $CONFIG_FILE" >&2
  exit 1
fi

echo "[info] profile: $PROFILE_DIR"

python3 - <<'PY' "$CONFIG_FILE" "$PROFILE_DIR"
import json, pathlib, re, sys
cfg_path = pathlib.Path(sys.argv[1])
profile = pathlib.Path(sys.argv[2]).resolve()
cfg = json.loads(cfg_path.read_text())

paths = [pathlib.Path(p).resolve() for p in cfg.get('skills', {}).get('paths', [])]
if not paths:
    print('[fail] skills.paths is empty')
    raise SystemExit(1)

# Expected discovered names: all names under configured skill paths
expected = {}
for root in paths:
    if not root.exists():
        print(f'[fail] skill path missing: {root}')
        raise SystemExit(1)
    for p in sorted(root.rglob('SKILL.md')):
        t = p.read_text(errors='ignore')
        m = re.search(r'^name:\s*(.+)$', t, re.M)
        if not m:
            continue
        name = m.group(1).strip().strip('"')
        expected[name] = str(p)

perm = cfg.get('permission', {}).get('skill', {})
if perm.get('*') != 'deny':
    print('[fail] permission.skill["*"] must be deny')
    raise SystemExit(1)

allowlisted = {k for k,v in perm.items() if k != '*' and v == 'allow'}
expected_names = set(expected.keys())

extra_allow = sorted(allowlisted - expected_names)
missing_allow = sorted(expected_names - allowlisted)

if extra_allow:
    print('[fail] allowlist contains names not found in configured skill paths:')
    for n in extra_allow:
        print(' -', n)
    raise SystemExit(1)
if missing_allow:
    print('[fail] skills exist in configured paths but are not allowlisted:')
    for n in missing_allow:
        print(' -', n)
    raise SystemExit(1)

# Check that all configured skill paths are under the profile dir
for p in paths:
    if profile not in [p, *p.parents]:
        print(f'[fail] skill path escapes profile dir: {p}')
        raise SystemExit(1)

print('[ok] allowlist and paths are consistent')
print('[ok] discovered skills:')
for n in sorted(expected_names):
    print(f' - {n} -> {expected[n]}')

print('\n[required runtime env]')
print(' OPENCODE_CONFIG_DIR=' + str(profile))
print(' OPENCODE_CONFIG=' + str(profile / 'opencode.json'))
print(' OPENCODE_DISABLE_EXTERNAL_SKILLS=1')
print(' OPENCODE_DISABLE_PROJECT_CONFIG=1')
PY
