#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)

[[ -f "$ROOT/agents/advisor.md" ]]
[[ -f "$ROOT/agents/claude-advisor.md" ]]
[[ -f "$ROOT/runtime/bootstrap.mjs" ]]
[[ -f "$ROOT/runtime/server.mjs" ]]

printf 'PASS: Claude advisor and MCP runtime entrypoints are present.\n'
