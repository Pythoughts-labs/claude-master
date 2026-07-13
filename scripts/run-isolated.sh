#!/usr/bin/env bash

set -euo pipefail

if (( $# == 0 )); then
  printf 'command required\n' >&2
  exit 64
fi

TIMEOUT_SECONDS=${RUN_TIMEOUT_SECONDS:-0}
CAP=()

if [[ "$TIMEOUT_SECONDS" == 0 ]]; then
  :
elif [[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  TIMEOUT_BIN=$(command -v gtimeout || command -v timeout || true)
  if [[ -n "$TIMEOUT_BIN" ]]; then
    CAP=("$TIMEOUT_BIN" "$TIMEOUT_SECONDS")
  else
    printf 'RUN_TIMEOUT_SECONDS=%s requires timeout or gtimeout\n' "$TIMEOUT_SECONDS" >&2
    exit 69
  fi
else
  printf 'RUN_TIMEOUT_SECONDS must be 0 or a positive integer\n' >&2
  exit 64
fi

if (( ${#CAP[@]} )); then
  COMMAND=("${CAP[@]}" "$@")
else
  COMMAND=("$@")
fi

terminate_process_group() {
  local pid=$1

  if kill -0 "-$pid" 2>/dev/null; then
    kill -TERM "-$pid" 2>/dev/null || true
    sleep 0.1
    kill -KILL "-$pid" 2>/dev/null || true
  fi
}

if command -v setsid >/dev/null 2>&1; then
  setsid "${COMMAND[@]}" <&0 &
else
  perl -MPOSIX -e 'POSIX::setsid() >= 0 or die "setsid: $!"; exec @ARGV or die "exec: $!"' "${COMMAND[@]}" <&0 &
fi
DELEGATED_PID=$!
trap 'terminate_process_group "$DELEGATED_PID"' EXIT INT TERM HUP

set +e
wait "$DELEGATED_PID"
STATUS=$?
set -e

terminate_process_group "$DELEGATED_PID"
trap - EXIT INT TERM HUP
exit "$STATUS"
