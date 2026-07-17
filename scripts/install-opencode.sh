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
  ".opencode/agents/codex-implementer.md:agents/codex-implementer.md"
  ".opencode/agents/claude-advisor.md:agents/claude-advisor.md"
  ".opencode/agents/pi-implementer.md:agents/pi-implementer.md"
  ".opencode/agents/pythinker-implementer.md:agents/pythinker-implementer.md"
  "skills/delegate/SKILL.md:skills/delegate/SKILL.md"
  "scripts/run-isolated.sh:claude-architect/scripts/run-isolated.sh"
  "scripts/run-codex-isolated.sh:claude-architect/scripts/run-codex-isolated.sh"
  "scripts/run-opencode-isolated.sh:claude-architect/scripts/run-opencode-isolated.sh"
  "scripts/run-pi-isolated.sh:claude-architect/scripts/run-pi-isolated.sh"
  "scripts/run-pythinker-isolated.sh:claude-architect/scripts/run-pythinker-isolated.sh"
)

mkdir -p "$DEST_ROOT/agents" "$DEST_ROOT/skills/delegate" "$DEST_ROOT/claude-architect/scripts"

for entry in "${MANAGED_FILES[@]}"; do
  destination="$DEST_ROOT/${entry#*:}"
  cp -p "$ROOT/${entry%%:*}" "$destination"
  printf '%s\n' "$destination"
done
