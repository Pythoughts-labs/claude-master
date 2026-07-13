#!/usr/bin/env bash

set -euo pipefail

TIMEOUT_SECONDS=${CODEX_TIMEOUT_SECONDS:-0}

if [[ "$TIMEOUT_SECONDS" == 0 ]]; then
  :
elif [[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  if ! command -v gtimeout >/dev/null 2>&1 && ! command -v timeout >/dev/null 2>&1; then
    printf 'ERROR: CODEX_TIMEOUT_SECONDS=%s requires timeout or gtimeout; install coreutils or set CODEX_TIMEOUT_SECONDS=0.\n' "$TIMEOUT_SECONDS" >&2
    exit 69
  fi
else
  printf 'ERROR: CODEX_TIMEOUT_SECONDS must be 0 or a positive integer; got %q\n' "$TIMEOUT_SECONDS" >&2
  exit 64
fi

if [[ "$0" == */* ]]; then
  SCRIPT_DIR=${0%/*}
else
  SCRIPT_DIR=.
fi
RUN_TIMEOUT_SECONDS=$TIMEOUT_SECONDS \
  exec "$BASH" "$SCRIPT_DIR/run-isolated.sh" \
    codex exec --ignore-user-config --ephemeral "$@"
