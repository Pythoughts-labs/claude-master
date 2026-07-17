#!/usr/bin/env bash

set -euo pipefail

if (( $# != 2 )) || [[ ! -r "$1" || -z "$2" ]]; then
  printf 'usage: %s <spec-file> <final-file>\n' "${0##*/}" >&2
  exit 64
fi

SPEC=$1
FINAL=$2
TIMEOUT_SECONDS=${OPENCODE_TIMEOUT_SECONDS:-900}
COMMAND=(opencode run --dir "$(pwd)" --agent build --auto --log-level ERROR)

if [[ -n "${OPENCODE_MODEL:-}" ]]; then
  COMMAND+=(--model "$OPENCODE_MODEL")
fi
if [[ -n "${OPENCODE_VARIANT:-}" ]]; then
  COMMAND+=(--variant "$OPENCODE_VARIANT")
fi

if [[ "$0" == */* ]]; then
  SCRIPT_DIR=${0%/*}
else
  SCRIPT_DIR=.
fi
RUN_TIMEOUT_SECONDS=$TIMEOUT_SECONDS \
  exec "$BASH" "$SCRIPT_DIR/run-isolated.sh" "${COMMAND[@]}" \
    <"$SPEC" >"$FINAL" 2>&1
