#!/usr/bin/env bash

set -euo pipefail

usage() {
  printf 'usage: %s --project <project-root> | --global\n' "${0##*/}" >&2
  exit 64
}

if (( $# == 2 )) && [[ "$1" == --project ]] && [[ -n "$2" && "$2" != --* ]]; then
  DEST_ROOT=$2/.opencode
elif (( $# == 1 )) && [[ "$1" == --global ]]; then
  DEST_ROOT=${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}
else
  usage
fi

if [[ "$0" == */* ]]; then
  SCRIPT_DIR=${0%/*}
else
  SCRIPT_DIR=.
fi
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

# <source relative to the repository root>:<destination relative to DEST_ROOT>
MANAGED_FILES=(
  "skills/delegate/SKILL.md:skills/delegate/SKILL.md"
)

# Files managed by the final release that shipped the retired prose lanes.
# Each file is removed only when its bytes still match the shipped asset. A
# modified file may be user-owned, so an upgrade stops and reports the conflict
# before changing the installation.
RETIRED_FILES=(
  "agents/codex-implementer.md:d0343d21d456a8be3f82381d584f7f464144701e52c44384919f0019ec7041ef"
  "agents/claude-advisor.md:5f3dda36a5ac303fb7be5b61aff4c95f39ee4411a6849a5ab19d88fa9729ef10"
  "agents/pi-implementer.md:2b9b76fb8bf53d9d9c57df902d7c42b9a0456b5a75043e82cb2ae98e49b2b898"
  "agents/pythinker-implementer.md:45a8b7390038e025a29ee275e0bb9862448aa9afbc759571b55f30397eb836a4"
  "claude-architect/scripts/run-isolated.sh:438916b981e2265a88ff7665296a9d3e5bb3bbc683912083238949efca35d6d7"
  "claude-architect/scripts/run-codex-isolated.sh:55651fdffab89269b3dd4d1d13ccd69ac4662f6fb92debfd3d28c0f621a3973e"
  "claude-architect/scripts/run-opencode-isolated.sh:48715f999757cf8506c311fbf10d647716b73a883b6da46a866e62e039d2d96a"
  "claude-architect/scripts/run-pi-isolated.sh:23b1c2082677c87f13046d2798165f679b38013f59b099f96f4c57d97c7f9eb8"
  "claude-architect/scripts/run-pythinker-isolated.sh:58978a04f03e3e03b4b3f9691ec1944ff05793c4d02d834310542a60e768edd3"
)

file_sha256() {
  local file=$1

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    return 69
  fi
}

retirement_conflicts=()
for entry in "${RETIRED_FILES[@]}"; do
  destination="$DEST_ROOT/${entry%%:*}"
  expected_hash=${entry#*:}
  [[ -e "$destination" || -L "$destination" ]] || continue

  if [[ ! -f "$destination" || -L "$destination" ]]; then
    retirement_conflicts+=("$destination (not a regular file)")
    continue
  fi
  if ! actual_hash=$(file_sha256 "$destination"); then
    retirement_conflicts+=("$destination (no SHA-256 utility available)")
    continue
  fi
  if [[ "$actual_hash" != "$expected_hash" ]]; then
    retirement_conflicts+=("$destination (content differs from the retired managed asset)")
  fi
done

if (( ${#retirement_conflicts[@]} )); then
  for conflict in "${retirement_conflicts[@]}"; do
    printf 'CONFLICT: preserved %s\n' "$conflict" >&2
  done
  exit 73
fi

for entry in "${RETIRED_FILES[@]}"; do
  destination="$DEST_ROOT/${entry%%:*}"
  [[ -e "$destination" ]] || continue
  rm -f "$destination"
  printf 'retired %s\n' "$destination"
done

# Remove only directories made empty by retirement. User-owned files keep their
# containing directories intact.
rmdir "$DEST_ROOT/agents" 2>/dev/null || true
rmdir "$DEST_ROOT/claude-architect/scripts" 2>/dev/null || true
rmdir "$DEST_ROOT/claude-architect" 2>/dev/null || true

mkdir -p "$DEST_ROOT/skills/delegate"

for entry in "${MANAGED_FILES[@]}"; do
  destination="$DEST_ROOT/${entry#*:}"
  cp -p "$ROOT/${entry%%:*}" "$destination"
  printf '%s\n' "$destination"
done
