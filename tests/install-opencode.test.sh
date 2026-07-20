#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
INSTALLER="$ROOT/scripts/install-opencode.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

write_retired_claude_advisor() {
  local destination=$1

  mkdir -p "$(dirname "$destination")"
  cat > "$destination" <<'EOF'
---
description: Read-only second opinion for architecture decisions, migrations, API designs, broad refactors, repeated failures, and final acceptance reviews.
mode: subagent
permission:
  read: allow
  glob: allow
  grep: allow
  bash: deny
  edit: deny
---

# Claude Advisor

Inspect the relevant code before answering. Give a direct verdict, the reason, and the single risk that decides it. Name precisely any missing fact that would change the answer. Do not implement or edit files, do not expand scope, and stay under roughly 300 words.
EOF
}

assert_managed_layout() {
  local base=$1

  cmp -s "$ROOT/skills/delegate/SKILL.md" "$base/skills/delegate/SKILL.md" ||
    fail "$base/skills/delegate/SKILL.md does not byte-match its source"
  [[ ! -e "$base/agents" ]] || fail "$base unexpectedly contains legacy agents"
  [[ ! -e "$base/claude-architect/scripts" ]] ||
    fail "$base unexpectedly contains legacy isolated launchers"
}

assert_reported_destination() {
  local base=$1
  local output=$2
  local expected="$base/skills/delegate/SKILL.md"

  grep -Fxq "$expected" "$output" || fail "installer did not report $expected"
  [[ $(wc -l < "$output" | tr -d ' ') -eq 1 ]] ||
    fail 'installer reported an unexpected number of destinations'
}

assert_project_install() {
  local project="$TMP/project with spaces"
  local base="$project/.opencode"
  local output="$TMP/project-output"

  (cd "$TMP" && bash "$INSTALLER" --project "$project") > "$output"
  assert_managed_layout "$base"
  assert_reported_destination "$base" "$output"

  write_retired_claude_advisor "$base/agents/claude-advisor.md"
  printf 'keep me\n' > "$base/agents/unrelated.md"
  printf '{"keep":true}\n' > "$base/opencode.json"
  printf 'stale\n' > "$base/skills/delegate/SKILL.md"
  bash "$INSTALLER" --project "$project" > "$output"
  cmp -s "$ROOT/skills/delegate/SKILL.md" "$base/skills/delegate/SKILL.md" ||
    fail 'reinstall did not refresh the managed skill'
  [[ ! -e "$base/agents/claude-advisor.md" ]] ||
    fail 'reinstall retained an unmodified retired managed agent'
  grep -Fxq "retired $base/agents/claude-advisor.md" "$output" ||
    fail 'reinstall did not report the retired managed agent'
  grep -Fxq 'keep me' "$base/agents/unrelated.md" || fail 'reinstall removed an unrelated agent'
  grep -Fxq '{"keep":true}' "$base/opencode.json" || fail 'reinstall changed unrelated config'

  printf 'PASS: project install is MCP-only, deterministic, and non-destructive.\n'
}

assert_modified_retired_asset_conflicts() {
  local project="$TMP/project-conflict"
  local base="$project/.opencode"
  local retired="$base/agents/claude-advisor.md"
  local status

  write_retired_claude_advisor "$retired"
  printf '\nuser customization\n' >> "$retired"

  set +e
  bash "$INSTALLER" --project "$project" > "$TMP/conflict-output" 2> "$TMP/conflict-error"
  status=$?
  set -e

  [[ "$status" -eq 73 ]] || fail "modified retired asset exited $status instead of 73"
  grep -Fxq 'user customization' "$retired" || fail 'conflict handling modified a user-owned asset'
  [[ ! -e "$base/skills/delegate/SKILL.md" ]] || fail 'conflict handling performed a partial install'
  grep -Fq "CONFLICT: preserved $retired (content differs from the retired managed asset)" \
    "$TMP/conflict-error" || fail 'conflict handling did not identify the preserved asset'

  printf 'PASS: modified retired assets are preserved and reported before writes.\n'
}

assert_retirement_inventory() {
  local retired

  for retired in \
    agents/codex-implementer.md \
    agents/claude-advisor.md \
    agents/pi-implementer.md \
    agents/pythinker-implementer.md \
    claude-architect/scripts/run-isolated.sh \
    claude-architect/scripts/run-codex-isolated.sh \
    claude-architect/scripts/run-opencode-isolated.sh \
    claude-architect/scripts/run-pi-isolated.sh \
    claude-architect/scripts/run-pythinker-isolated.sh; do
    grep -Fq "\"$retired:" "$INSTALLER" || fail "retirement inventory omits $retired"
  done

  printf 'PASS: every previously managed legacy asset is in the retirement inventory.\n'
}

assert_global_installs() {
  local home="$TMP/home"
  local xdg="$TMP/xdg"
  local configured="$TMP/custom config"
  local default_base="$xdg/opencode"

  HOME="$home" XDG_CONFIG_HOME="$xdg" bash "$INSTALLER" --global > "$TMP/global-output"
  assert_managed_layout "$default_base"
  assert_reported_destination "$default_base" "$TMP/global-output"

  HOME="$home" XDG_CONFIG_HOME="$xdg" OPENCODE_CONFIG_DIR="$configured" \
    bash "$INSTALLER" --global > "$TMP/custom-output"
  assert_managed_layout "$configured"
  assert_reported_destination "$configured" "$TMP/custom-output"
  [[ ! -e "$home/.config/opencode" ]] || fail 'global install ignored XDG_CONFIG_HOME'

  printf 'PASS: global install honors XDG and OPENCODE_CONFIG_DIR precedence.\n'
}

assert_invalid_arguments() {
  local case_name=0
  local status
  local target

  while IFS= read -r -d '' arguments; do
    case_name=$((case_name + 1))
    target="$TMP/invalid-$case_name"
    read -r -a argv <<< "$arguments"
    set +e
    HOME="$target/home" XDG_CONFIG_HOME="$target/xdg" OPENCODE_CONFIG_DIR="$target/config" \
      bash "$INSTALLER" ${argv[@]+"${argv[@]}"} > "$target.stdout" 2> "$target.stderr"
    status=$?
    set -e
    [[ "$status" -eq 64 ]] || fail "invalid form $case_name exited $status instead of 64"
    grep -Fxq 'usage: install-opencode.sh --project <project-root> | --global' "$target.stderr" ||
      fail "invalid form $case_name did not fail installer argument validation"
    [[ ! -e "$target/home" && ! -e "$target/xdg" && ! -e "$target/config" ]] ||
      fail "invalid form $case_name created a partial install tree"
    [[ ! -e "$ROOT/--global" ]] || fail "invalid form $case_name wrote relative to the caller's cwd"
  done < <(printf '%s\0' \
    '' \
    '--project' \
    '--project --global' \
    '--global --project nowhere' \
    '--project one --project two' \
    '--global extra' \
    '--project nowhere extra' \
    '--unknown')

  printf 'PASS: invalid, mixed, missing, and extra arguments fail before writes.\n'
}

assert_project_install
assert_global_installs
assert_invalid_arguments
assert_modified_retired_asset_conflicts
assert_retirement_inventory

printf 'PASS: OpenCode installer ships only the MCP delegate skill.\n'
