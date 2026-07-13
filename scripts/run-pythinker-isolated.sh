#!/usr/bin/env bash

set -euo pipefail

if (( $# != 2 )) || [[ ! -r "$1" || -z "$2" ]]; then
  printf 'usage: %s <spec-file> <final-file>\n' "${0##*/}" >&2
  exit 64
fi

SPEC=$1
FINAL=$2
TIMEOUT_SECONDS=${PYTHINKER_TIMEOUT_SECONDS:-900}
COMMAND=(pythinker --quiet --prompt "$(<"$SPEC")" --work-dir "$(pwd)" --yolo)

if [[ -n "${PYTHINKER_MODEL:-}" ]]; then
  COMMAND+=(--model "$PYTHINKER_MODEL")
fi
if [[ -n "${PYTHINKER_THINKING_EFFORT:-}" ]]; then
  COMMAND+=(--thinking-effort "$PYTHINKER_THINKING_EFFORT")
fi

if [[ "$0" == */* ]]; then
  SCRIPT_DIR=${0%/*}
else
  SCRIPT_DIR=.
fi
RUN_TIMEOUT_SECONDS=$TIMEOUT_SECONDS \
  exec "$BASH" "$SCRIPT_DIR/run-isolated.sh" "${COMMAND[@]}" \
    </dev/null >"$FINAL" 2>&1
