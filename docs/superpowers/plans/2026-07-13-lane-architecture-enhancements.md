# Lane Architecture Enhancements Implementation Plan

> **For agentic workers:** Execute this plan task by task. Keep the red/green order for behavioral tests, review every diff before committing, and do not continue past a failed verification step.

**Status:** Revised after architecture review on 2026-07-13.

**Goal:** Give every implementation lane the same tested process-isolation lifecycle without erasing the CLI-specific behavior that makes each lane runnable. Keep the Claude Code and OpenCode host packages consistent, make model fallback explicit, and verify edited local assets before release.

**Architecture:** `scripts/run-isolated.sh` is the one deep process-lifecycle module. It owns process-group creation, signal cleanup, optional timeout enforcement, stdin forwarding, and exit-status propagation. Thin executable adapters own each CLI's prompt transport, flags, working directory, model override, and output capture. Agent files remain self-contained, but call those adapters instead of embedding fragile command lines. Claude Code locates adapters through `CLAUDE_PLUGIN_ROOT`; OpenCode gets the same runtime through an explicit installer and a documented project/global lookup contract.

**Why this seam:** Process isolation is genuinely shared. Prompt transport is not: Codex consumes stdin, Pi consumes an `@file` plus a directive, Pythinker consumes `--prompt`, and OpenCode accepts piped stdin but still requires its own permission and working-directory flags. The shared module must hide lifecycle complexity without pretending those CLI interfaces are identical.

**Verified CLI baseline:**

- Claude Code `2.1.207`; local plugin development uses `claude --plugin-dir <path>`.
- Codex CLI `0.144.1`; the existing `codex exec` contract remains unchanged.
- OpenCode `1.17.18`; `opencode run` accepts piped stdin, `--dir`, `--agent`, `--auto`, `--model`, and `--variant`.
- Pi `0.80.6`; a bare `-` is not a prompt argument. Non-interactive work uses `-p`, an `@file` attachment, a directive message, and closed stdin.
- Pythinker `0.58.0`; the executable is `pythinker`, non-interactive work uses `--quiet --prompt ... --work-dir ... --yolo`, and reasoning overrides use `--thinking-effort`.

## Global Constraints

- Preserve the current Codex contract exactly:
  - `CODEX_TIMEOUT_SECONDS` defaults to `0` (uncapped).
  - malformed values exit `64` and include `CODEX_TIMEOUT_SECONDS must be 0 or a positive integer`.
  - a positive timeout with no `timeout`/`gtimeout` binary exits `69` before Codex starts.
  - delegated Codex runs receive `--ignore-user-config --ephemeral`.
  - stdin is forwarded byte-for-byte.
  - the delegated process group is terminated on normal exit, timeout, or signal.
- Timeout policy belongs to adapters, not `run-isolated.sh`:
  - Codex remains uncapped by default.
  - Pi, Pythinker, and OpenCode default to a 900-second cap.
  - any positive cap is fail-closed when no timeout binary is available.
  - setting the lane-specific timeout variable to `0` explicitly disables the cap.
- Preserve each CLI's existing non-interactive and safety flags. Do not replace all prompt transports with stdin.
- The three harness lanes omit model and thinking flags when the architect names no override. Their CLIs then use configured defaults. Codex remains pinned to GPT-5.6 Sol at low reasoning unless the caller overrides it.
- Agent definitions stay self-contained. Do not introduce a generator, build step, or shared prose include.
- Tests may assert semantic invariants in agent prose, but must not require whole paragraphs to be byte-identical.
- The host rosters are exact:
  - Claude Code `agents/`: `codex-implementer`, `opencode-implementer`, `pi-implementer`, `pythinker-implementer`, `claude-advisor`.
  - OpenCode `.opencode/agents/`: `codex-implementer`, `pi-implementer`, `pythinker-implementer`, `claude-advisor`.
  - `opencode-implementer` remains absent from the OpenCode host because OpenCode must not recursively delegate to itself.
- Do not edit Claude Code marketplace caches or mirrors by hand.
- Do not bump the marketplace version in this plan. At release time, advance the minor version and keep `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, the README badge, and `CHANGELOG.md` synchronized.
- Register every new automated test in `scripts/validate-release.sh`.
- Run `bash scripts/validate-release.sh` before any release push.

## Runtime Interfaces

### Generic isolation module

```text
scripts/run-isolated.sh <command> [args...]
```

- Reads `RUN_TIMEOUT_SECONDS`; default `0`.
- `0` means no wall-clock cap.
- A positive integer requires `gtimeout` or `timeout`; if neither exists, exit `69` before starting the command.
- Any other value exits `64` with `RUN_TIMEOUT_SECONDS must be 0 or a positive integer`.
- Missing command exits `64`.
- Runs the command in a new process group using `setsid`, with the existing Perl/POSIX fallback.
- Preserves stdin exactly.
- On `EXIT`, `INT`, `TERM`, or `HUP`, terminates the entire process group.
- Returns the delegated command's status, including timeout status `124`.
- Contains no Codex, Pi, Pythinker, OpenCode, model, or prompt knowledge.

### Codex adapter

```text
scripts/run-codex-isolated.sh <codex-exec-args...>
```

- Public interface and behavior stay unchanged.
- Reads `CODEX_TIMEOUT_SECONDS`; default `0`.
- Validates the Codex variable itself so existing diagnostics remain stable.
- Executes `run-isolated.sh codex exec --ignore-user-config --ephemeral ...` with `RUN_TIMEOUT_SECONDS` mapped from `CODEX_TIMEOUT_SECONDS`.

### Pi adapter

```text
scripts/run-pi-isolated.sh <spec-file> <final-file>
```

- Reads optional `PI_MODEL` and `PI_THINKING` overrides.
- Reads `PI_TIMEOUT_SECONDS`; default `900`.
- Uses `pi -p --no-session --no-skills` with the deterministic tool allowlist.
- Supplies the spec as `@<spec-file>` plus a short directive message.
- Redirects stdin from `/dev/null` so Pi cannot block waiting for more input.
- Captures stdout and stderr in `<final-file>`.
- Omits `--model` and `--thinking` independently when their override is empty.

### Pythinker adapter

```text
scripts/run-pythinker-isolated.sh <spec-file> <final-file>
```

- Reads optional `PYTHINKER_MODEL` and `PYTHINKER_THINKING_EFFORT` overrides.
- Reads `PYTHINKER_TIMEOUT_SECONDS`; default `900`.
- Executes the `pythinker` binary, not `pythinker-code`.
- Uses `--quiet --prompt "$(<"$SPEC")" --work-dir "$(pwd)" --yolo`.
- Adds `--model` only when `PYTHINKER_MODEL` is non-empty.
- Adds `--thinking-effort` only when `PYTHINKER_THINKING_EFFORT` is non-empty.
- Redirects stdin from `/dev/null` and captures stdout and stderr in `<final-file>`.

### OpenCode adapter

```text
scripts/run-opencode-isolated.sh <spec-file> <final-file>
```

- Reads optional `OPENCODE_MODEL` and `OPENCODE_VARIANT` overrides.
- Reads `OPENCODE_TIMEOUT_SECONDS`; default `900`.
- Uses `opencode run --dir "$(pwd)" --agent build --auto --log-level ERROR`.
- Adds `--model` and `--variant` only when their corresponding override is non-empty.
- Pipes the spec file to stdin, which `opencode run` supports.
- Captures stdout and stderr in `<final-file>`.

## OpenCode Runtime Location

OpenCode does not define `CLAUDE_PLUGIN_ROOT`. Its agents locate the installed runtime in this order:

1. `CLAUDE_ARCHITECT_ROOT`, when explicitly set.
2. Starting at `$PWD`, walk parent directories up to the filesystem root. At each ancestor, check:
   - source checkout: `<ancestor>/scripts/run-*-isolated.sh` plus a matching `.claude-plugin/plugin.json`;
   - project installation: `<ancestor>/.opencode/claude-architect/scripts/run-*-isolated.sh`.
3. Custom OpenCode config: `${OPENCODE_CONFIG_DIR}/claude-architect`, when `OPENCODE_CONFIG_DIR` is set.
4. Global installation: `${XDG_CONFIG_HOME:-$HOME/.config}/opencode/claude-architect`.

This mirrors OpenCode's project discovery behavior when it is launched from a nested directory. Resolution must not assume `$PWD` equals the project root.

If no candidate contains the required executable adapter, the agent returns its structured `STATUS: unavailable` report with an actionable installation message. It must not fall back to an inline command or implement the task itself.

## File Map

**Create:**

- `scripts/run-isolated.sh`
- `scripts/run-pi-isolated.sh`
- `scripts/run-pythinker-isolated.sh`
- `scripts/run-opencode-isolated.sh`
- `scripts/install-opencode.sh`
- `tests/run-isolated.test.sh`
- `tests/lane-launchers.test.sh`
- `tests/install-opencode.test.sh`
- `tests/lane-contract.test.mjs`
- `tests/lane-roster.test.mjs`
- `tests/lane-model-fallback.test.mjs`

**Modify:**

- `scripts/run-codex-isolated.sh`
- `scripts/validate-release.sh`
- `skills/delegate/SKILL.md`
- `agents/codex-implementer.md`
- `agents/pi-implementer.md`
- `agents/pythinker-implementer.md`
- `agents/opencode-implementer.md`
- `.opencode/agents/codex-implementer.md`
- `.opencode/agents/pi-implementer.md`
- `.opencode/agents/pythinker-implementer.md`
- `README.md`
- `CHANGELOG.md`

**Remove locally if present and empty:**

- `skills/orchestration/`

---

## Task 1: Establish the baseline and local development workflow

**Files:** None.

- [ ] Run the current release gate before editing:

```bash
bash scripts/validate-release.sh
```

Expected: every current check passes.

- [ ] Record the CLI surfaces used by the adapters:

```bash
claude --version
codex --version
opencode run --help
pi --help
pythinker info
```

Expected: the commands and required flags listed in **Verified CLI baseline** are present. If an installed CLI has a newer incompatible interface, stop and revise the relevant adapter contract before implementation.

- [ ] Validate the plugin without installing it:

```bash
claude plugin validate --strict .
```

- [ ] Use direct local loading for all later Claude Code smoke tests:

```bash
claude --plugin-dir "$PWD"
```

Do not use marketplace installation as a live-working-tree mechanism. Marketplace installs resolve to cached copies and do not prove that later edits are active.

No commit is produced by this task.

---

## Task 2: Extract the generic isolation module without changing Codex behavior

**Files:**

- Create `tests/run-isolated.test.sh`.
- Create `scripts/run-isolated.sh`.
- Modify `scripts/run-codex-isolated.sh`.
- Preserve `tests/codex-lifecycle.test.sh` as the Codex regression guard.

### Step 1: Write the generic runner test first

- [ ] Cover both the external `setsid` branch and Perl fallback with controlled `PATH` shims.
- [ ] In both branches assert exact argv, byte-for-byte stdin, delegated exit status, and cleanup of a background descendant.
- [ ] Assert missing command and malformed timeout exit `64` before command startup.
- [ ] Assert a positive timeout with no timeout binary exits `69` before command startup.
- [ ] Assert a positive timeout is passed to the timeout executable.
- [ ] With a real `timeout` or `gtimeout`, assert expiration returns `124` and kills descendants. Skip only this integration case when neither binary exists.
- [ ] Assert the generic runner never injects CLI-specific arguments.

Run the test before creating the runner:

```bash
bash tests/run-isolated.test.sh
```

Expected: fails because `scripts/run-isolated.sh` does not exist.

### Step 2: Implement `run-isolated.sh`

- [ ] Move only process-group, trap, timeout, stdin, wait, and status behavior into the new module.
- [ ] Keep `RUN_TIMEOUT_SECONDS` defaulted to `0`.
- [ ] Fail closed with exit `69` whenever a positive requested cap cannot be enforced.
- [ ] Keep the `setsid` and Perl fallback branches behaviorally equivalent.

### Step 3: Reduce the Codex script to a thin adapter

- [ ] Keep validation and diagnostics in terms of `CODEX_TIMEOUT_SECONDS`.
- [ ] Keep the default at `0`.
- [ ] Build `codex exec --ignore-user-config --ephemeral "$@"`.
- [ ] `exec` the generic runner with `RUN_TIMEOUT_SECONDS` set to the validated Codex value.

### Step 4: Verify generic and Codex behavior

```bash
bash tests/run-isolated.test.sh
bash tests/codex-lifecycle.test.sh
bash -n scripts/run-isolated.sh scripts/run-codex-isolated.sh
shellcheck scripts/run-isolated.sh scripts/run-codex-isolated.sh tests/run-isolated.test.sh tests/codex-lifecycle.test.sh
```

Expected: all pass. In particular, the existing Codex missing-timeout assertion must still exit `69`; do not weaken that test.

### Step 5: Commit

```bash
git add scripts/run-isolated.sh scripts/run-codex-isolated.sh tests/run-isolated.test.sh
git commit -m "refactor: extract shared process isolation runner"
```

---

## Task 3: Add thin executable adapters for Pi, Pythinker, and OpenCode

**Files:**

- Create `scripts/run-pi-isolated.sh`.
- Create `scripts/run-pythinker-isolated.sh`.
- Create `scripts/run-opencode-isolated.sh`.
- Create `tests/lane-launchers.test.sh`.

### Step 1: Write stub-backed launcher tests first

Build temporary fake `pi`, `pythinker`, and `opencode` executables that record argv and stdin and emit a known final message. Run the real adapter scripts against those fakes.

- [ ] Every adapter rejects a missing or unreadable spec and missing final path with exit `64` before starting the CLI.
- [ ] Every adapter reaches `run-isolated.sh`; do not merely grep for the filename.
- [ ] Every adapter maps its lane timeout variable to `RUN_TIMEOUT_SECONDS`.
- [ ] Pi assertions:
  - `-p`, `--no-session`, `--no-skills`, and the tool allowlist are present.
  - the spec appears as an `@file` argument with a directive message.
  - stdin is empty.
  - bare `-` is absent.
  - output reaches the final file.
- [ ] Pythinker assertions:
  - executable name is `pythinker`.
  - `--quiet`, `--prompt`, `--work-dir`, and `--yolo` are present.
  - prompt content equals the complete spec.
  - stdin is empty.
  - output reaches the final file.
- [ ] OpenCode assertions:
  - `run`, `--dir`, `--agent build`, `--auto`, and `--log-level ERROR` are present.
  - spec bytes arrive on stdin.
  - output reaches the final file.
- [ ] For every harness adapter, run one case with no overrides and assert model/thinking flags are absent.
- [ ] Run another case with overrides and assert each value is forwarded exactly once.

Run before implementation:

```bash
bash tests/lane-launchers.test.sh
```

Expected: fails because the adapter scripts do not exist.

### Step 2: Implement the adapters

- [ ] Keep each script focused on one CLI.
- [ ] Validate arguments before any CLI starts.
- [ ] Use arrays for every optional flag; do not construct shell command strings.
- [ ] Resolve `run-isolated.sh` relative to the adapter's own directory.
- [ ] Redirect output inside the adapter so every caller receives a populated final file.
- [ ] Make the three new adapters executable and confirm the generic and Codex runners remain executable.

### Step 3: Verify

```bash
bash tests/lane-launchers.test.sh
bash tests/run-isolated.test.sh
bash tests/codex-lifecycle.test.sh
bash -n scripts/run-*-isolated.sh
shellcheck scripts/run-*-isolated.sh tests/lane-launchers.test.sh
```

### Step 4: Commit

```bash
git add scripts/run-pi-isolated.sh scripts/run-pythinker-isolated.sh scripts/run-opencode-isolated.sh tests/lane-launchers.test.sh
git commit -m "feat: add isolated launchers for harness lanes"
```

---

## Task 4: Route Claude Code agents through the tested adapters

**Files:**

- Modify `agents/pi-implementer.md`.
- Modify `agents/pythinker-implementer.md`.
- Modify `agents/opencode-implementer.md`.
- Review `agents/codex-implementer.md` for unchanged Codex semantics.
- Modify `skills/delegate/SKILL.md`.

### Step 1: Normalize temporary-file lifecycle, then replace invocation blocks

- [ ] Preserve each agent's preflight, verification step, and structured report.
- [ ] In all three harness agents, create both files before the invocation and install cleanup immediately. Use the lane-specific prefixes shown here:

```bash
# agents/pi-implementer.md
SPEC=$(mktemp -t pi-spec.XXXXXX)
FINAL=$(mktemp -t pi-final.XXXXXX)
trap 'rm -f "$SPEC" "$FINAL"' EXIT

# agents/pythinker-implementer.md
SPEC=$(mktemp -t pythinker-spec.XXXXXX)
FINAL=$(mktemp -t pythinker-final.XXXXXX)
trap 'rm -f "$SPEC" "$FINAL"' EXIT

# agents/opencode-implementer.md
SPEC=$(mktemp -t opencode-spec.XXXXXX)
FINAL=$(mktemp -t opencode-final.XXXXXX)
trap 'rm -f "$SPEC" "$FINAL"' EXIT
```

- [ ] Pi currently creates only `SPEC` and assigns `FINAL` after its inline command. Move `FINAL` creation before the adapter call and remove the later assignment.
- [ ] Pythinker and OpenCode already create both files but currently lack cleanup traps. Add the trap without changing their spec content.
- [ ] Confirm `SPEC` and `FINAL` are defined before any adapter receives them.
- [ ] Pi calls:

```bash
PI_MODEL="${MODEL:-}" \
PI_THINKING="${THINKING:-}" \
bash "$CLAUDE_PLUGIN_ROOT/scripts/run-pi-isolated.sh" "$SPEC" "$FINAL"
```

- [ ] Pythinker calls:

```bash
PYTHINKER_MODEL="${MODEL:-}" \
PYTHINKER_THINKING_EFFORT="${THINKING_EFFORT:-}" \
bash "$CLAUDE_PLUGIN_ROOT/scripts/run-pythinker-isolated.sh" "$SPEC" "$FINAL"
```

- [ ] OpenCode calls:

```bash
OPENCODE_MODEL="${PROVIDER_MODEL:-}" \
OPENCODE_VARIANT="${VARIANT:-}" \
bash "$CLAUDE_PLUGIN_ROOT/scripts/run-opencode-isolated.sh" "$SPEC" "$FINAL"
```

- [ ] Remove inline timeout construction from these agent files. Timeout mechanism now belongs to `run-isolated.sh`; lane policy belongs to each adapter.
- [ ] Do not copy adapter flags back into agent prose as an alternative command.

### Step 2: Align model fallback language

For Pi, Pythinker, and OpenCode, state all of the following:

- An architect-supplied model or thinking override is forwarded exactly.
- With no override, the adapter omits the flag and the CLI's configured default applies.
- The report names the resolved model when the CLI exposes it; if it cannot be resolved, the report says so rather than guessing.
- There is no plugin-level default for harness lanes.

When no model override is supplied, update each preflight to resolve the CLI's configured model before performing provider- or backend-specific availability checks. A fallback path that cannot identify the producer must return `STATUS: unavailable` or explicitly report the unresolved producer; it must not guess a provider.

Keep Codex's documented GPT-5.6 Sol and low-reasoning default unchanged.

### Step 3: Update lane selection guidance

- [ ] Update `skills/delegate/SKILL.md` so selecting a lane remains mandatory but selecting a model within a harness lane is optional.
- [ ] Preserve the exact product rule that no implementation lane is selected implicitly.
- [ ] Preserve the Codex reasoning override list.
- [ ] Update Pi guidance so `--thinking` is optional and otherwise comes from Pi configuration.
- [ ] Update Pythinker guidance to expose its supported `--thinking-effort off|minimal|low|medium|high|xhigh|max` override instead of claiming that no shared reasoning flag exists.
- [ ] Keep OpenCode's model-specific `--variant` override optional.

### Step 4: Verify

```bash
bash tests/lane-launchers.test.sh
bash tests/codex-lifecycle.test.sh
node tests/delegate-routing.test.mjs
```

### Step 5: Commit

```bash
git add agents/codex-implementer.md agents/pi-implementer.md agents/pythinker-implementer.md agents/opencode-implementer.md skills/delegate/SKILL.md
git commit -m "refactor: route Claude lanes through tested launchers"
```

---

## Task 5: Package and route the OpenCode host runtime

**Files:**

- Create `scripts/install-opencode.sh`.
- Create `tests/install-opencode.test.sh`.
- Modify `.opencode/agents/codex-implementer.md`.
- Modify `.opencode/agents/pi-implementer.md`.
- Modify `.opencode/agents/pythinker-implementer.md`.
- Modify `README.md` OpenCode installation instructions.

### Step 1: Define the installer interface

```text
bash scripts/install-opencode.sh --project <project-root>
bash scripts/install-opencode.sh --global
```

- `--project` installs agents under `<project-root>/.opencode/agents`, the delegate skill under `<project-root>/.opencode/skills/delegate`, and runtime scripts under `<project-root>/.opencode/claude-architect/scripts`.
- `--global` installs the same assets under `${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}`.
- Exactly one mode is required. Invalid arguments exit `64` without writing files.
- The installer copies only tracked source assets, creates missing parent directories, preserves executable bits, and reports each destination.
- Re-running the installer updates managed files deterministically.
- The installer never deletes unrelated user agents, skills, or config.

### Step 2: Write installer tests first

- [ ] Install into a temporary project and assert all expected agents, skill, and runtime scripts exist.
- [ ] Install with temporary `HOME` and `XDG_CONFIG_HOME` and assert the global layout.
- [ ] Set a temporary `OPENCODE_CONFIG_DIR` and assert it takes precedence for global installation and lookup.
- [ ] Compare installed managed files byte-for-byte with source files.
- [ ] Assert runtime scripts remain executable.
- [ ] Create an unrelated agent before install and assert it survives reinstall.
- [ ] Assert invalid argument combinations produce no partial tree.

Run before implementation:

```bash
bash tests/install-opencode.test.sh
```

Expected: fails because the installer does not exist.

### Step 3: Implement and verify the installer

```bash
bash tests/install-opencode.test.sh
bash -n scripts/install-opencode.sh
shellcheck scripts/install-opencode.sh tests/install-opencode.test.sh
```

### Step 4: Route all OpenCode-host lanes

- [ ] Add the documented runtime lookup order to all three OpenCode implementation agents, including ancestor traversal from a nested working directory.
- [ ] Codex calls `run-codex-isolated.sh` from the resolved runtime.
- [ ] Pi calls `run-pi-isolated.sh` from the resolved runtime.
- [ ] Pythinker calls `run-pythinker-isolated.sh` from the resolved runtime.
- [ ] Return `STATUS: unavailable` with the install command when no runtime is found.
- [ ] Never reference `CLAUDE_PLUGIN_ROOT` from `.opencode/agents/`.
- [ ] Keep `opencode-implementer.md` absent from `.opencode/agents/`.

### Step 5: Align the OpenCode-host agent contracts

Before writing the cross-host tests in Task 6, update all three OpenCode implementation agents so each is self-contained and includes:

- the complete five-part spec contract;
- unique `SPEC` and `FINAL` creation plus cleanup;
- the same model and thinking fallback semantics as its Claude-host counterpart;
- preflight against the resolved model/provider when no override is supplied;
- invocation through the resolved runtime adapter;
- actual diff/status inspection and independent verification;
- the complete structured report status set;
- an explicit statement that producer self-report is not evidence.

Keep OpenCode-host prose concise, but do not rely on the shared skill to supply obligations a subagent must carry in its own system prompt.

### Step 6: Update OpenCode installation documentation

Replace manual copy instructions with the installer commands. Document:

- project and global installation layouts;
- `CLAUDE_ARCHITECT_ROOT` as an explicit override;
- ancestor lookup for project installations and `OPENCODE_CONFIG_DIR` for custom global config;
- source-repository execution as a development mode;
- the need to restart OpenCode after agent or skill installation.

### Step 7: Verify nested-directory resolution

Install into a temporary project, create a nested directory at least two levels below the project root, and execute each agent's runtime-resolution logic with that nested directory as `$PWD`. Assert that every lane resolves the project-installed adapter. Repeat with a temporary custom `OPENCODE_CONFIG_DIR` and global install.

### Step 8: Commit

```bash
git add scripts/install-opencode.sh tests/install-opencode.test.sh .opencode/agents README.md
git commit -m "feat: package shared lane runtime for OpenCode"
```

---

## Task 6: Guard semantic lane contracts, model fallback, and host rosters

**Files:**

- Create `tests/lane-contract.test.mjs`.
- Create `tests/lane-model-fallback.test.mjs`.
- Create `tests/lane-roster.test.mjs`.

### Step 1: Test semantic contracts across both hosts

For every implementation agent that exists on each host, assert the file contains the required semantic obligations without requiring identical prose:

- the five-part spec: objective, files, interfaces, constraints, verification;
- no silent implementation fallback;
- unique temporary spec and final output paths;
- invocation through the correct tested adapter;
- actual diff/status inspection;
- independent re-run of the verification command;
- producer self-report is not accepted as evidence;
- structured status values include `complete`, `partial`, `timeout`, and `unavailable`.

Also reject executable launch lines that directly start `codex exec`, `pi -p`, `pythinker --quiet`, or `opencode run`, and reject inline `CAP=` timeout construction. Anchor these checks to shell command lines so explanatory prose and preflight commands do not produce false failures.

### Step 2: Test model fallback as product behavior

- [ ] Pi, Pythinker, and OpenCode agent files on every applicable host document CLI-default fallback.
- [ ] Their adapter scripts construct model/thinking arguments conditionally; behavioral proof remains in `tests/lane-launchers.test.sh`.
- [ ] `skills/delegate/SKILL.md` and `README.md` agree that lane selection is mandatory and harness model selection is optional.
- [ ] Both Codex host agents and the delegate skill retain GPT-5.6 Sol at low reasoning by default.
- [ ] Both Codex launch paths retain `model_reasoning_effort=low` unless overridden.
- [ ] Pythinker guidance on both hosts and in the delegate skill documents `--thinking-effort`; no source claims Pythinker lacks a shared reasoning override.

Do not use a test source file as a canonical documentation home. The delegate skill is the routing source; executable adapters and agent files are the behavior sources.

### Step 3: Test exact host rosters

Read every `.md` file in `agents/` and `.opencode/agents/`, sort the complete filenames, and compare against the exact expected arrays. Do not filter only names ending in `-implementer.md`; unexpected agent files must fail the test too.

### Step 4: Run the tests

```bash
node tests/lane-contract.test.mjs
node tests/lane-model-fallback.test.mjs
node tests/lane-roster.test.mjs
node tests/delegate-routing.test.mjs
```

### Step 5: Commit

```bash
git add tests/lane-contract.test.mjs tests/lane-model-fallback.test.mjs tests/lane-roster.test.mjs
git commit -m "test: guard lane contracts across both hosts"
```

---

## Task 7: Clean dead structure and integrate the release gate

**Files:**

- Remove empty `skills/orchestration/` locally if it exists.
- Modify `scripts/validate-release.sh`.
- Modify `README.md` for behavior changes not already covered in Task 5.
- Modify `CHANGELOG.md` under `[Unreleased]`.

### Step 1: Remove only confirmed dead structure

```bash
test -d skills/orchestration && test -z "$(find skills/orchestration -mindepth 1 -print -quit)" && rmdir skills/orchestration || true
```

Git does not track empty directories. Do not create a cleanup commit when this produces no tracked change.

### Step 2: Register every new test

Add these commands to `scripts/validate-release.sh` after existing checks:

```bash
bash tests/run-isolated.test.sh
bash tests/lane-launchers.test.sh
bash tests/install-opencode.test.sh
node tests/lane-contract.test.mjs
node tests/lane-model-fallback.test.mjs
node tests/lane-roster.test.mjs
```

Keep `tests/validate-release.test.sh` tracked and running. Do not describe it as untracked; it is already part of the repository.

### Step 3: Update published behavior

Update README and `[Unreleased]` changelog text to state:

- every lane uses the shared process-isolation lifecycle through a CLI-specific adapter;
- Codex is uncapped by default, while harness lanes default to a fail-closed 900-second cap;
- harness model and thinking overrides are optional and otherwise defer to CLI configuration;
- OpenCode installation includes the runtime scripts through `install-opencode.sh`.

Do not bump release versions in this task.

### Step 4: Run static and release checks

```bash
shellcheck scripts/*.sh tests/*.sh
git diff --check
bash scripts/validate-release.sh
```

Expected: all pass with no warnings treated as errors.

### Step 5: Commit

```bash
git add scripts/validate-release.sh README.md CHANGELOG.md
git commit -m "chore: integrate lane architecture checks"
```

---

## Task 8: Verify local host wiring and real CLIs

This task produces evidence only. Do not commit scratch repositories, generated final messages, credentials, or CLI state.

### Step 1: Verify Claude Code loads the edited tree directly

Start Claude Code with:

```bash
claude --plugin-dir "$PWD"
```

Confirm the plugin's delegate skill and four Claude implementation agents are visible. Do not infer this from a marketplace cache path.

### Step 2: Verify OpenCode source and installed layouts

- From this repository, confirm OpenCode sees the four `.opencode/agents/` files and delegate skill.
- Install into a temporary project with `bash scripts/install-opencode.sh --project "$TMP_PROJECT"`.
- From a nested directory under that temporary project, confirm each OpenCode implementation agent resolves the ancestor `.opencode/claude-architect/scripts` without `CLAUDE_PLUGIN_ROOT`.

### Step 3: Smoke-test each launcher in an isolated scratch repository

For each available CLI:

1. Create a fresh temporary git repository.
2. Write a spec that creates `hello.txt` containing exactly `hello` and verifies it with `test "$(cat hello.txt)" = hello`.
3. Create a unique final-output file.
4. Invoke the corresponding adapter with the desired model override, or no override to exercise configured fallback.
5. Inspect `git status`, `git diff`, final output, and verification result.
6. Record PASS/FAIL, exact CLI version, exact resolved model when available, and whether an override or configured default was used.

If a CLI is missing, unauthenticated, or has no configured default model, record `SKIP` with the exact reason. Do not treat environment unavailability as a product pass.

### Step 4: Verify cleanup without global `pgrep` assumptions

Capture the relevant process IDs before each smoke run and compare them after completion. Assert no new descendant from the launched adapter remains. Do not require `pgrep -fl codex` to return no results globally; unrelated sessions may already exist.

### Step 5: Final acceptance

```bash
bash scripts/validate-release.sh
git diff --check
git status --short
```

Expected:

- release validation passes from the source checkout;
- only intended tracked files are modified;
- scratch files and runtime outputs are outside the repository;
- any skipped real-CLI smoke is explicitly recorded before release.

---

## Acceptance Criteria

- One generic module owns process-group lifecycle and no CLI policy.
- Four thin adapters preserve their producer's actual CLI interface.
- Codex timeout defaults and fail-closed behavior are unchanged.
- Harness lanes use explicit 900-second adapter policy and fail closed when it cannot be enforced.
- Every adapter has stub-backed behavioral tests for argv, stdin, model fallback, and output capture.
- Claude Code tests edited assets with `--plugin-dir`, not a cached marketplace install.
- OpenCode receives the runtime scripts through a deterministic installer and never relies on `CLAUDE_PLUGIN_ROOT`.
- Both host rosters and semantic agent contracts are guarded.
- README, delegate skill, agent files, executable adapters, and changelog describe the same model and timeout behavior.
- `bash scripts/validate-release.sh` passes before release work begins.

## Explicit Non-Goals

- No marketplace version bump, tag, or push.
- No generator or build pipeline for agent markdown.
- No recursive `opencode-implementer` lane inside OpenCode.
- No replacement of CLI-specific prompt transports with a universal stdin convention.
- No direct edits to installed Claude Code cache or marketplace mirror directories.
