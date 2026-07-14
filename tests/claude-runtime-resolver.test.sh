#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

extract_resolver() {
  local agent=$1
  local output=$2

  awk '
    /<!-- BEGIN CLAUDE_ARCHITECT_RUNTIME_RESOLVER -->/ { inside=1; next }
    /<!-- END CLAUDE_ARCHITECT_RUNTIME_RESOLVER -->/ { inside=0; found=1; next }
    inside && $0 !~ /^```/ { print }
    END { if (!found) exit 1 }
  ' "$agent" > "$output" || fail "no runtime resolver block in $agent"
}

for lane in codex opencode pi pythinker; do
  adapter=run-$lane-isolated.sh
  block="$TMP/$lane-resolver.sh"
  extract_resolver "$ROOT/agents/$lane-implementer.md" "$block"

  nohome="$TMP/nohome-$lane"
  mkdir -p "$nohome"

  # 1) CLAUDE_PLUGIN_ROOT wins when the host exports it.
  resolved=$(cd "$TMP" && HOME="$nohome" CLAUDE_PLUGIN_ROOT="$ROOT" bash "$block")
  [[ "$resolved" == "$ROOT/scripts/$adapter" ]] ||
    fail "$lane: CLAUDE_PLUGIN_ROOT resolution returned $resolved"

  # 2) Without the env var, the ancestor walk finds a plugin checkout —
  # but only one that also carries the shared run-isolated.sh companion.
  checkout="$TMP/checkout-$lane"
  nested="$checkout/work/a/b"
  mkdir -p "$checkout/.claude-plugin" "$checkout/scripts" "$nested"
  printf '{}\n' > "$checkout/.claude-plugin/plugin.json"
  cp "$ROOT/scripts/$adapter" "$checkout/scripts/$adapter"
  set +e
  (cd "$nested" && HOME="$nohome" env -u CLAUDE_PLUGIN_ROOT bash "$block" > /dev/null 2>&1)
  status=$?
  set -e
  [[ "$status" -eq 69 ]] ||
    fail "$lane: checkout without run-isolated.sh resolved anyway (exit $status)"
  cp "$ROOT/scripts/run-isolated.sh" "$checkout/scripts/run-isolated.sh"
  resolved=$(cd "$nested" && HOME="$nohome" env -u CLAUDE_PLUGIN_ROOT bash "$block")
  [[ "$resolved" == "$checkout/scripts/$adapter" ]] ||
    fail "$lane: ancestor-walk resolution returned $resolved"

  # 3) Outside any checkout, the newest COMPLETE installed cache copy wins.
  # The plugin installer strips the executable bit, so cache copies are 644,
  # and a stale newest version missing run-isolated.sh must be skipped.
  fakehome="$TMP/home-$lane"
  for version in 0.9.0 0.10.0 0.11.0; do
    mkdir -p "$fakehome/.claude/plugins/cache/mkt/claude-architect/$version/scripts"
    cp "$ROOT/scripts/$adapter" \
      "$fakehome/.claude/plugins/cache/mkt/claude-architect/$version/scripts/$adapter"
    if [[ "$version" != 0.11.0 ]]; then
      cp "$ROOT/scripts/run-isolated.sh" \
        "$fakehome/.claude/plugins/cache/mkt/claude-architect/$version/scripts/run-isolated.sh"
    fi
    chmod 644 "$fakehome/.claude/plugins/cache/mkt/claude-architect/$version/scripts/"*
  done
  outside="$TMP/outside-$lane"
  mkdir -p "$outside"
  resolved=$(cd "$outside" && HOME="$fakehome" env -u CLAUDE_PLUGIN_ROOT bash "$block")
  [[ "$resolved" == "$fakehome/.claude/plugins/cache/mkt/claude-architect/0.10.0/scripts/$adapter" ]] ||
    fail "$lane: cache resolution returned $resolved instead of the newest complete (0.10.0) copy"

  # 4) Nothing found -> structured unavailable report and exit 69.
  set +e
  output=$(cd "$outside" && HOME="$nohome" env -u CLAUDE_PLUGIN_ROOT bash "$block" 2>&1)
  status=$?
  set -e
  [[ "$status" -eq 69 ]] || fail "$lane: missing runtime exited $status instead of 69"
  grep -q 'STATUS: unavailable' <<< "$output" ||
    fail "$lane: missing runtime did not report STATUS: unavailable"

  printf 'PASS: %s resolves %s via plugin root, checkout walk, cache, and fails closed.\n' \
    "$lane" "$adapter"
done

printf 'PASS: Claude host runtime resolution is verified.\n'
