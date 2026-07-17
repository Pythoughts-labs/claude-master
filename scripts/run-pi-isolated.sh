#!/usr/bin/env bash

set -euo pipefail

if (( $# != 2 )) || [[ ! -r "$1" || -z "$2" ]]; then
  printf 'usage: %s <spec-file> <final-file>\n' "${0##*/}" >&2
  exit 64
fi

SPEC=$1
FINAL=$2
TIMEOUT_SECONDS=${PI_TIMEOUT_SECONDS:-900}
COMMAND=(pi -p --no-session --no-skills --tools 'read,bash,edit,write,grep,find,ls')

if [[ -n "${PI_MODEL:-}" ]]; then
  COMMAND+=(--model "$PI_MODEL")
fi
if [[ -n "${PI_THINKING:-}" ]]; then
  COMMAND+=(--thinking "$PI_THINKING")
fi
COMMAND+=("@$SPEC" 'Implement the attached spec, verify the work, and report the final result.')

if [[ "$0" == */* ]]; then
  SCRIPT_DIR=${0%/*}
else
  SCRIPT_DIR=.
fi
RUN_TIMEOUT_SECONDS=$TIMEOUT_SECONDS \
  exec "$BASH" "$SCRIPT_DIR/run-isolated.sh" "${COMMAND[@]}" \
    </dev/null >"$FINAL" 2>&1
