# Legacy Codex MCP Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Use
> superpowers:test-driven-development for every behavior change and
> superpowers:verification-before-completion before reporting success.

**Goal:** Retire the legacy Codex shell edit route. Keep Claude Code on the
complete packaged MCP lifecycle and add a project-local OpenCode compatibility
path that can delegate and review through the same runtime but cannot decide or
integrate candidates.

**Architecture:** `handleDelegate`, `AttemptRuntime`, Candidate Artifact
freezing, verification, decision records, and Controlled Integration stay
unchanged. A small generated stdio gateway is the only new trusted production
seam: it forwards MCP traffic to `runtime/bootstrap.mjs`, removes
`decideCandidate` and `integrateCandidate` from discovery, and rejects either
call before forwarding. `install-opencode.sh --project` packages the immutable
gateway/runtime closure and writes a managed `.opencode/opencode.jsonc` without
dirtying the Git checkout.

**Supported compatibility profile:** OpenCode `>=1.18.3 <2.0.0`, Node.js 22+,
Bash project installation on macOS and Linux, an existing clean canonical Git
worktree, and project-local OpenCode configuration. Native Windows project
installation and global Codex MCP configuration remain unavailable.

**Tech stack:** TypeScript 5.9, Node.js streams/child processes, esbuild, MCP
JSON-RPC over stdio, Vitest 2.1, Bash installer tests, real Git repositories,
OpenCode local MCP configuration, and existing Claude plugin validation.

## Global Constraints

- Do not change `src/runtime/attempt-runtime.ts`, runtime recovery, pipeline,
  verifier, Candidate Artifact, Host Decision, Controlled Integration,
  capability policy, protocol schemas, model attestation, or confinement
  behavior.
- Keep protocol marker `1.1.0`, Delegation Spec version `1`, and existing MCP
  tool input/output contracts unchanged.
- Do not add `--lane-mode edit` work. It is the current shell baseline to
  characterize and then retire.
- Do not fall back from any Host/gateway/runtime validation, startup,
  eligibility, confinement, timeout, cancellation, or verification result to
  `run-codex-isolated.sh`, a Codex agent, or direct `codex exec`.
- OpenCode may call delegation, pipeline, review, doctor, and bounded Git-read
  operations only. It must not discover or forward decision/integration.
- Treat OpenCode permissions as defense in depth, not the security boundary.
  The gateway must enforce its tool subset even if project config, `--auto`, or
  "Allow always" changes effective Host permission behavior.
- OpenCode candidates remain `pending-human-decision`. Do not manually apply
  their patches or imply a cross-Host handoff exists.
- The installer must not execute OpenCode config/agent/skill/MCP/run commands
  in the user's project. Real OpenCode discovery runs only in a fresh synthetic
  test project with isolated HOME/XDG/config paths.
- Project installation must leave a previously clean checkout clean under the
  exact porcelain query used by `src/git/repo-preconditions.ts`.
- Store OpenCode `CLAUDE_PLUGIN_DATA` at an absolute canonical path outside the
  repository and installed runtime.
- Preserve unrelated OpenCode config, agents, skills, local Git excludes, and
  files byte-for-byte. Never broadly ignore `.opencode`.
- Do not expand OpenCode, Producer, model, platform, or confinement
  certification claims.
- Global mode may retain non-Codex migration assets but must not install a
  global Codex MCP server.
- Do not create commits unless explicitly authorized. Do not tag, push,
  publish, or amend as part of this plan unless separately requested.

## File Map

**Create:**

- `src/mcp/opencode-gateway.ts`: protocol filter and child lifecycle.
- `src/opencode-gateway-entry.ts`: generated-runtime entrypoint only.
- `runtime/opencode-gateway.mjs`: generated gateway bundle.
- `tests/runtime/opencode-gateway.test.ts`: filter, transparency, bounds, and
  process cleanup.
- `tests/runtime/fixtures/fake-mcp-child.mjs`: deterministic gateway child.
- `tests/runtime/fixtures/edit-then-sleep.mjs`: timeout-after-edit Producer.
- `tests/runtime/helpers/mcp-stdio-client.ts`: bounded progress-aware test client.
- `tests/runtime/opencode-mcp-install.test.ts`: installed closure and handshake.
- `tests/runtime/opencode-mcp-host.test.ts`: isolated real OpenCode discovery.
- `tests/runtime/opencode-mcp-e2e.test.ts`: installed lifecycle and concurrency.
- `tests/legacy-codex-retirement.test.mjs`: active-surface retirement guard.
- `tests/fixtures/opencode-v0.19/run-codex-isolated.sh.txt`: non-executable
  prior-release bytes for ownership-checked upgrade coverage.
- `tsconfig.tests.json`: strict type-check coverage for source and tests.

**Modify:**

- `esbuild.config.mjs`
- `scripts/install-opencode.sh`
- `scripts/validate-release.sh`
- `tests/install-opencode.test.sh`
- `tests/validate-release.test.sh`
- `tests/runtime/handshake.smoke.test.ts`
- `tests/runtime/attempt-runtime.test.ts`
- `tests/runtime/bootstrap-check.test.ts`
- `tests/runtime/plugin-wiring.test.mjs`
- `tests/runtime/isolated-scripts.test.ts`
- `tests/claude-runtime-resolver.test.sh`
- `skills/delegate/SKILL.md`
- `agents/codex-implementer.md`
- `.opencode/agents/codex-implementer.md`
- `tests/delegate-routing.test.mjs`
- `tests/lane-contract.test.mjs`
- `tests/lane-model-fallback.test.mjs`
- `tests/lane-roster.test.mjs`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PLUGIN_COMPONENTS.md`
- `docs/SECURITY_MODEL.md`
- `docs/TRUST_BOUNDARIES.md`
- `docs/THREAT_MODEL.md`
- `docs/PRIVACY.md`
- `docs/MARKETPLACE_REVIEW.md`
- `assets/social-card.svg`
- `assets/social-preview.png`
- `CHANGELOG.md`
- `scratchpad.md`

**Delete only after all replacement gates pass:**

- `scripts/run-codex-isolated.sh`
- `tests/codex-lifecycle.test.sh`

---

### Task 1: Characterize The Current Route And Pin Inherited Fail-Closed Behavior

**Files:**

- Create: `tests/legacy-codex-retirement.test.mjs`
- Create: `tests/runtime/fixtures/edit-then-sleep.mjs`
- Modify: `tests/runtime/attempt-runtime.test.ts`
- Temporarily modify: `tests/codex-lifecycle.test.sh`

- [ ] **Step 1: Record the current baseline, not the superseded defect**

Run:

```bash
bash tests/codex-lifecycle.test.sh
node tests/lane-contract.test.mjs
npx vitest run tests/runtime/isolated-scripts.test.ts
```

Expected at current `main`: PASS. Confirm both active Codex agents invoke
`run-codex-isolated.sh --lane-mode edit` and do not pass raw `--sandbox` or
`--cd`. Record the earlier exit-65 command only as historical context in
`scratchpad.md`.

- [ ] **Step 2: Add a composed current-route characterization**

Extend `tests/codex-lifecycle.test.sh` before deleting it. Extract the executable
command shape from both agent files and run the equivalent invocation through
the real wrapper with fake Codex. Assert:

- `--lane-mode edit` is consumed by the wrapper;
- fake Codex receives exactly one `--sandbox workspace-write` and one physical
  `--cd <worktree>` supplied by the wrapper;
- caller sandbox/cwd/approval overrides are still rejected;
- stdin, final output, stderr capture, timeout, process-tree cleanup, and
  concurrent sentinel isolation match the current contract.

Run the shell test and expect PASS. This is characterization evidence, not a
new target contract.

- [ ] **Step 3: Add the permanent retirement guard and record RED**

Create `tests/legacy-codex-retirement.test.mjs`. It must ignore historical
plans/released changelog entries and assert:

```js
assert.equal(exists("scripts/run-codex-isolated.sh"), false);
assert.equal(exists("tests/codex-lifecycle.test.sh"), false);
```

For active agents, skills, installer output, runtime resolvers, README, and
current component/marketplace docs, reject executable Codex shell commands,
raw Codex edit flags, and shell fallback language. Permit the obsolete installed
path only inside a delimited hash-checked cleanup block in the installer and
inside non-executable upgrade fixtures.

Run `node tests/legacy-codex-retirement.test.mjs` and expect RED because the
current shell route still ships.

- [ ] **Step 4: Characterize timeout after a landed worktree edit**

Create `tests/runtime/fixtures/edit-then-sleep.mjs`, which writes one authorized
file, emits a valid final event, then sleeps. Add a `FakeAdapter` option and this
test to `tests/runtime/attempt-runtime.test.ts`:

```ts
it("does not freeze worktree edits landed before producer timeout", async () => {
  const repoRoot = await initRepo();
  const spec = validSpec();
  spec.timeoutMs = 100;
  const result = await runAttempt(
    repoRoot,
    spec,
    dependencies(new FakeAdapter({ editThenSleepMs: 60_000 }), "run-timeout-edit"),
  );
  expect(result).toMatchObject({ status: "failed", failure: "timeout", candidate: null });
  expect(await readFile(join(repoRoot, "a.txt"), "utf8")).toBe("hello\n");
  await expectAttemptResourcesCleaned("run-timeout-edit");
});
```

Run with the existing empty-candidate, dirty-checkout, no-confinement,
protocol-mismatch, and stale-base cases. Expected: PASS without runtime source
changes. If any inherited behavior fails, stop and open a separate runtime
design rather than expanding this migration.

---

### Task 2: Build The OpenCode MCP Gateway Test-First

**Files:**

- Create: `src/mcp/opencode-gateway.ts`
- Create: `src/opencode-gateway-entry.ts`
- Create: `tests/runtime/opencode-gateway.test.ts`
- Create: `tests/runtime/fixtures/fake-mcp-child.mjs`

**Public source interface:**

```ts
export const OPENCODE_ALLOWED_TOOLS: readonly string[];
export const OPENCODE_FORBIDDEN_TOOLS: readonly string[];
export async function startOpenCodeGateway(
  dependencies?: OpenCodeGatewayDependencies,
): Promise<void>;
```

- [ ] **Step 1: Add failing discovery and forwarding tests**

The fake child must speak newline-delimited JSON-RPC, return all ten current
runtime tools from `tools/list`, echo allowed calls, emit progress
notifications, and append every received message to a private record file.

Add tests that start the gateway with injected child executable/argv and assert:

- `tools/list` preserves the original response id/content but returns exactly
  the eight allowed tools in original order;
- direct `tools/call` requests for `decideCandidate` and
  `integrateCandidate` receive a stable JSON-RPC error and never appear in the
  child record;
- an unknown synthetic future tool is omitted from `tools/list` and its direct
  `tools/call` is rejected before the child;
- allowed tool calls and their results are byte/structure equivalent after
  JSON parse;
- initialize, initialized notification, errors, string/number ids, and progress
  notifications pass unchanged;
- concurrent tools/list and tools/call ids cannot cross responses, while the
  same id may be outstanding once in each opposite direction;
- duplicate pending ids, malformed request objects, and invalid tool-call names
  fail closed.

Run `npx vitest run tests/runtime/opencode-gateway.test.ts` and record RED.

- [ ] **Step 2: Add failing bounds and child-lifecycle tests**

Require:

- a 32-MiB maximum protocol line and 1-MiB bounded stderr diagnostics;
- incomplete final lines, invalid UTF-8/JSON, oversized lines, and child stdout
  protocol violations terminate the gateway nonzero without forwarding partial
  output;
- child spawn error/early exit rejects pending traffic;
- parent EOF closes child stdin;
- SIGINT/SIGTERM forwards once, waits at least the bootstrap 3-second grace,
  escalates to process-group kill when needed, and waits for final exit;
- stdout remains protocol-only and diagnostics remain on stderr;
- no shell command string or inherited delegated-recursion marker is introduced.

- [ ] **Step 3: Implement the narrow filter**

In `src/mcp/opencode-gateway.ts`:

1. Parse one complete JSON-RPC object per line from parent stdin and child
   stdout with bounded buffers.
2. Classify requests, responses, and notifications by JSON-RPC shape. Maintain
   separate parent-to-child and child-to-parent pending maps using a
   type-preserving canonical id key; reject duplicate outstanding ids only
   within the same direction and clear each id on its matching response.
3. Mark parent `tools/list` requests in their pending record so only the
   corresponding child response is filtered.
4. For any inbound `tools/call` whose name is not in
   `OPENCODE_ALLOWED_TOOLS`, emit JSON-RPC error code `-32601` with a
   stable `operation unavailable on OpenCode compatibility host` message; do
   not forward or add a pending id.
5. Forward every other valid parent message to child stdin.
6. On a successful child response to a tracked `tools/list`, validate
   `result.tools`, reject duplicate names, and retain only the eight exact
   allowlisted definitions in the child's original order.
7. Forward other valid child messages unchanged after reserialization.
8. On protocol/lifecycle failure, stop both directions, terminate the complete
   child process group, and exit nonzero.

The default child is sibling `runtime/bootstrap.mjs`, launched with
`process.execPath` plus argv and inherited environment. Tests inject a fake
child through dependencies, never a production environment override.

`src/opencode-gateway-entry.ts` calls `startOpenCodeGateway()` and emits only a
bounded stderr diagnostic on failure.

- [ ] **Step 4: Verify Task 2**

```bash
npx tsc --noEmit
npx vitest run tests/runtime/opencode-gateway.test.ts
git diff --check -- \
  src/mcp/opencode-gateway.ts src/opencode-gateway-entry.ts \
  tests/runtime/opencode-gateway.test.ts \
  tests/runtime/fixtures/fake-mcp-child.mjs
```

Expected: all gateway protocol, authority, bound, and process tests pass. No
existing runtime module changes.

---

### Task 3: Generate And Validate The Gateway Runtime Asset

**Files:**

- Modify: `esbuild.config.mjs`
- Create generated: `runtime/opencode-gateway.mjs`
- Modify: `tests/runtime/bootstrap-check.test.ts`
- Modify: `scripts/validate-release.sh`
- Modify: `tests/validate-release.test.sh`

- [ ] **Step 1: Add failing generated-asset assertions**

Extend runtime/bootstrap and release tests to require non-empty
`runtime/opencode-gateway.mjs`, its generated banner, and deterministic rebuild
behavior alongside `runtime/server.mjs`. The release validator must snapshot
both generated bundles before `scripts/build-runtime.sh`, rebuild, compare
bytes, and reject a dirty generated diff.

Run focused tests and record RED because the gateway bundle does not exist.

- [ ] **Step 2: Build the server and gateway with separate targets**

Keep the existing server build call and add a second call:

```js
await build({
  entryPoints: ["src/opencode-gateway-entry.ts"],
  outfile: "runtime/opencode-gateway.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "// GENERATED by esbuild - do not edit. Source: src/opencode-gateway-entry.ts" },
});
```

Keep the existing ESM `createRequire` banner for the server. Use a separate
Node-20-compatible gateway build target because the gateway may start under the
first `node` on PATH while sibling `bootstrap.mjs` locates Node 22 for the
runtime. The gateway must remain dependency-free and parseable on Node 20.

Do not change the runtime's Node 22 execution floor.

- [ ] **Step 3: Build and inspect exact bytes**

Run:

```bash
bash scripts/build-runtime.sh
node --check runtime/opencode-gateway.mjs
npx vitest run \
  tests/runtime/opencode-gateway.test.ts \
  tests/runtime/bootstrap-check.test.ts
git diff --check -- esbuild.config.mjs \
  runtime/opencode-gateway.mjs tests/runtime/bootstrap-check.test.ts \
  scripts/validate-release.sh tests/validate-release.test.sh
```

Expected: both generated bundles are current and gateway behavior still passes
against source and packaged entrypoints.

---

### Task 4: Make Project Installation Canonical, Static, And Checkout-Clean

**Files:**

- Modify: `tests/install-opencode.test.sh`
- Modify: `scripts/install-opencode.sh`

**Installer exits:** `64` invalid invocation, `69` unavailable profile or
dependency, `73` identity/ownership conflict, `75` live/ambiguous concurrent
owner, `78` contradictory recovery evidence.

- [ ] **Step 1: Replace project fixtures with committed Git repositories**

Add `init_project()` to the shell test. Every `--project` case must create a
real repository, set command-local identity, add one tracked file, and commit
`HEAD`. Keep global legacy fixtures separate.

Add a fake `opencode` executable that supports `--version` only and fails if the
installer invokes `debug`, `agent`, `mcp`, or `run`. Record every invocation.

- [ ] **Step 2: Add failing project-preflight cases**

Prove before implementation:

- missing/non-Git/unborn/bare/nested-non-root/dirty projects fail before
  `.opencode` creation;
- missing OpenCode, malformed version, `1.18.2`, and `2.0.0` exit `69`, while
  `1.18.3` is accepted;
- native Windows/MSYS project mode reports unavailable rather than support;
- project, `.opencode`, managed parent, JSONC, runtime version, gateway, stage,
  journal, lock, local-exclude, and data-root symlinks/non-directory ancestors
  exit `73`;
- relative data root, repository-contained data, runtime-contained data, and
  symlinked ancestor exit `73`;
- tracked managed paths with different bytes conflict; byte-identical tracked
  destinations remain unchanged;
- root `opencode.json`, `.opencode/opencode.json`, unrelated agents/skills,
  tracked `.gitignore`, and pre-existing local excludes survive byte-for-byte;
- an unmarked `.opencode/opencode.jsonc` conflicts before writes;
- no test observes an installer call beyond `opencode --version`;
- install and reinstall leave this exact output empty:

```bash
git -C "$project" status --porcelain=v1 \
  --untracked-files=all --ignore-submodules=none
```

Run `bash tests/install-opencode.test.sh` and record RED.

- [ ] **Step 3: Implement read-only preflight**

In `scripts/install-opencode.sh`, keep one Bash entrypoint but use named
functions and an embedded Node path validator. Before managed destination
writes, project mode must:

1. Set `umask 077`; parse exactly one mode.
2. Require macOS/Linux, Bash, Git, Node 22+, and OpenCode
   `>=1.18.3 <2.0.0`. Run only `opencode --version`, from a private cwd with a
   minimal environment and bounded output.
3. Resolve `--project` canonically; require it equals
   `git rev-parse --show-toplevel`, is non-bare, has `HEAD`, and is clean under
   the exact status query above.
4. Resolve Git common dir and
   `git rev-parse --path-format=absolute --git-path info/exclude`.
5. Compute every source/destination pair and generated byte set before writes.
6. Use Node `lstat`, `realpath`, and `path.relative` to reject symlinks,
   non-directory ancestors, and escapes. Do not use string-prefix containment.
7. Require an absolute external data root; validate its nearest existing
   ancestor before creation and canonical location after creation.
8. Reject conflicting tracked paths, unknown markers, and non-regular source
   assets. If a source and destination resolve to the same inode (for example,
   dogfooding this plugin repository), require byte/mode identity and skip the
   copy and local-exclude entry rather than copying a file onto itself.

The installer must never source project files or invoke OpenCode discovery/run
commands.

- [ ] **Step 4: Add exact local excludes**

Preserve all existing local-exclude bytes outside one marked block:

```text
# BEGIN claude-architect opencode managed paths
/.opencode/.gitignore
/.opencode/opencode.jsonc
/.opencode/agents/codex-implementer.md
/.opencode/agents/claude-advisor.md
/.opencode/agents/pi-implementer.md
/.opencode/agents/pythinker-implementer.md
/.opencode/skills/delegate/SKILL.md
/.opencode/claude-architect/
# END claude-architect opencode managed paths
```

Do not add `/.opencode/`. Omit an exclude for a tracked byte-identical
destination. Create a managed `.opencode/.gitignore` only when absent, covering
OpenCode-generated `node_modules`, `package.json`, lock files, and itself.
Preserve a tracked user-owned file.

- [ ] **Step 5: Verify Task 4**

```bash
bash -n scripts/install-opencode.sh tests/install-opencode.test.sh
bash tests/install-opencode.test.sh
git diff --check -- scripts/install-opencode.sh tests/install-opencode.test.sh
```

Expected: static preflight, no-follow containment, exact preservation, no
project OpenCode execution, and clean checkout pass.

---

### Task 5: Publish An Immutable Gateway/Runtime Transaction And Safe Upgrades

**Files:**

- Create: `tests/fixtures/opencode-v0.19/run-codex-isolated.sh.txt`
- Modify: `tests/install-opencode.test.sh`
- Modify: `scripts/install-opencode.sh`

- [ ] **Step 1: Add failing closure/config assertions**

For plugin version `V`, require byte matches below
`.opencode/claude-architect/mcp/$V/` for:

- `runtime/bootstrap.mjs`
- `runtime/server.mjs`
- `runtime/opencode-gateway.mjs`
- `runtime/watchdog.mjs`
- all five versioned runtime schemas
- `native/bin/win32-job-kill-x64.exe`
- `package.json`
- an `install-manifest.json` containing relative path, mode, and SHA-256 for
  every managed byte plus the generated config hash.

The managed config command must be exactly
`["node", "<immutable>/runtime/opencode-gateway.mjs"]`; its data root must be
canonical/external. Assert there is no deprecated `tools` key and the permission
shape is:

```json
{
  "permission": { "claude-architect_*": "deny" },
  "agent": {
    "build": {
      "permission": {
        "claude-architect_delegate": "allow",
        "claude-architect_delegatePipeline": "allow",
        "claude-architect_reviewCandidate": "allow",
        "claude-architect_doctor": "allow",
        "claude-architect_gitStatus": "allow",
        "claude-architect_gitDiff": "allow",
        "claude-architect_gitLog": "allow",
        "claude-architect_gitChangedFiles": "allow",
        "claude-architect_decideCandidate": "deny",
        "claude-architect_integrateCandidate": "deny"
      }
    }
  }
}
```

- [ ] **Step 2: Add lock, interruption, and journal tests**

The project lock owner record contains PID, platform process-start token,
canonical project/common-dir identity, and transaction id. Build it as a
bounded regular file in the lock directory, fsync it, and publish it with an
atomic hard link to the fixed lock path. Linux tokens use `/proc/<pid>/stat`
start time plus boot id; macOS tokens use normalized
`ps -o lstart= -p <pid>`. An unreadable token is ambiguous, never stale. Add
deterministic cases for:

- matching live owner and unreadable/malformed/ambiguous owner: exit `75`;
- dead PID or PID-reuse token mismatch: quarantine and recover without
  signaling another process;
- lock symlink/identity replacement: conflict;
- `SIGTERM` cleanup and `SIGKILL` stale-lock/journal recovery;
- interruption after exclude publication, during stage copy, before immutable
  rename, before config activation, and after config rename before completion;
- contradictory journal/config/runtime hashes: exit `78` without guessing;
- two concurrent installers: second fails while first retains ownership;
- next normal run converges owned incomplete state and leaves status clean.

Use `PATH` shims for copy/move failures and a blocking shim for contention;
do not add production-only test failpoints.

- [ ] **Step 3: Add prior-release ownership tests**

Store exact non-executable v0.19 wrapper bytes in the fixture. Generate literal
release-owned SHA-256 values from supported tags `v0.15.0` through `v0.19.0`
plus the pre-deletion current source. Assert:

- exact known installed bytes are removed during upgrade;
- a missing path succeeds;
- one changed byte, tracked/ignored-user-owned path, symlink, directory, or
  special file is preserved and blocks activation;
- no deletion occurs by pathname alone.

The installer may name the obsolete path only inside a delimited
`BEGIN/END OBSOLETE CODEX OWNERSHIP CLEANUP` block.

- [ ] **Step 4: Implement config-last immutable publication**

After complete preflight and lock acquisition:

1. Publish the exact local-exclude block atomically.
2. Create a bounded no-follow transaction journal with prior config
   hash/absence, intended version/config/manifest hashes, stage identity, and
   phase; update it by atomic replacement.
3. Stage the full closure in a same-filesystem
   `.mcp-stage.<transaction-id>` directory with restrictive modes.
4. Hash every staged byte into `install-manifest.json`.
5. Start the staged gateway in a private cwd/environment/data root. Complete
   `initialize` and `tools/list`; require the exact eight allowed tools. Send
   forbidden decision/integration calls and require gateway errors without
   runtime side effects.
6. Rename to immutable `mcp/$V` only after bytes, modes, and manifest match. If
   it exists, reuse only on exact equality.
7. Publish non-activation skill/notices/legacy non-Codex files through
   sibling-temp atomic replacement.
8. Apply ownership-checked obsolete cleanup.
9. Verify exact Git status remains empty.
10. Atomically replace the marked JSONC last as activation.
11. Mark journal complete, remove owned stage/backups, and release the same
    lock identity.

Use the embedded Node no-follow writer for every durable exclude, journal,
manifest, config, and ownership transition: same-directory regular temp,
bounded write, file fsync, identity revalidation, atomic link/rename, then
parent-directory fsync before advancing the journal phase.

On ordinary failure, restore the previous config or remove a first-install
config. Complete inactive assets and exact excludes may remain to keep status
clean and allow convergence. Never point config at a stage or mutable version.

- [ ] **Step 5: Keep global mode limited**

Global mode continues non-Codex legacy installation and ownership-checked old
Codex cleanup, but writes no global MCP config. The installed Codex notice gives
project-install guidance. Preserve existing XDG/`OPENCODE_CONFIG_DIR` behavior
for Pi/Pythinker assets.

- [ ] **Step 6: Verify Task 5**

```bash
bash tests/install-opencode.test.sh
bash -n scripts/install-opencode.sh tests/install-opencode.test.sh
git diff --check -- \
  scripts/install-opencode.sh tests/install-opencode.test.sh \
  tests/fixtures/opencode-v0.19/run-codex-isolated.sh.txt
```

Expected: closure, gateway config, direct staged handshake, lock/journal
recovery, immutable reuse, released cleanup, unknown-file preservation, and
clean status all pass without executing OpenCode project discovery.

---

### Task 6: Add Strict Test Type-Checking And A Bounded MCP Client

**Files:**

- Create: `tsconfig.tests.json`
- Create: `tests/runtime/helpers/mcp-stdio-client.ts`
- Create: `tests/runtime/opencode-mcp-install.test.ts`
- Modify: `tests/runtime/handshake.smoke.test.ts`

- [ ] **Step 1: Type-check source and tests separately**

Create:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true, "rootDir": "." },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Run `npx tsc --noEmit -p tsconfig.tests.json`. Fix test typing only; do not
weaken strict options. Keep `npx tsc --noEmit` as the source gate.

- [ ] **Step 2: Add client tests and record RED**

Require the helper to:

- support request-specific inactivity timeout and progress token;
- attach `_meta.progressToken` and refresh only that request on matching
  progress notifications;
- reject all waiters on child error/exit/protocol failure;
- cap captured stdout/stderr;
- handle concurrent string/number ids without crossing;
- close stdin, TERM, wait beyond bootstrap's 3-second grace, KILL if needed,
  await exit, and make `close()` idempotent.

Export:

```ts
export interface McpStdioClient {
  request(
    method: string,
    params: Record<string, unknown>,
    options?: { inactivityTimeoutMs?: number; progressToken?: string | number },
  ): Promise<Record<string, unknown>>;
  notify(method: string, params: Record<string, unknown>): void;
  stdout(): string;
  stderr(): string;
  close(): Promise<void>;
}
```

- [ ] **Step 3: Implement and reuse the helper**

Use `spawn(command, argv, { cwd, env, stdio: ["pipe", "pipe", "pipe"],
windowsHide: true })`, executable-plus-argv only. Use a 30-second default
inactivity deadline; progress is liveness, not a whole-attempt extension.

Refactor `tests/runtime/handshake.smoke.test.ts` without changing its source
runtime assertions.

- [ ] **Step 4: Add installed gateway handshake tests**

For each test create one unique temporary container with sibling project,
external state, private cwd, home, and XDG directories. Initialize/commit the
project, install with the fake version-only OpenCode CLI, parse the managed
config, and start the exact gateway command/environment from a different cwd.

Complete initialize/initialized/tools-list and assert:

- exactly the eight allowed tools are visible;
- direct decision/integration calls return the gateway's stable error;
- invalid spec returns the existing runtime validation result;
- stdout is protocol-only and ready/diagnostic text is stderr-only;
- command/data paths are canonical and immutable/external;
- project status remains empty after shutdown;
- a path named `ca-\u03bb-\u6f22 with spaces` works.

- [ ] **Step 5: Verify Task 6**

```bash
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.tests.json
npx vitest run \
  tests/runtime/handshake.smoke.test.ts \
  tests/runtime/opencode-gateway.test.ts \
  tests/runtime/opencode-mcp-install.test.ts
```

Expected: both type-checks and source/gateway/installed handshakes pass with no
leaked processes or temporary state.

---

### Task 7: Cross Real OpenCode Discovery Only In A Synthetic Project

**Files:**

- Create: `tests/runtime/opencode-mcp-host.test.ts`
- Modify: `scripts/validate-release.sh`
- Modify: `tests/validate-release.test.sh`

- [ ] **Step 1: Add an explicit release-only Host gate**

Skip this file unless `RUN_OPENCODE_HOST_GATE=1`. When enabled, fail rather than
skip if OpenCode is missing, outside `>=1.18.3 <2.0.0`, or the OS is outside the
supported installer profile.

Create a fresh synthetic Git project with no custom tools/plugins/instructions.
Isolate `HOME`, all XDG directories, `OPENCODE_CONFIG_DIR`, caches, and state
inside its temporary container. Install with the production installer.

- [ ] **Step 2: Prove config, skill, permissions, and gateway discovery**

Only inside that synthetic environment run:

```text
opencode --version
opencode debug config --pure
opencode debug agent build --pure
opencode debug agent codex-implementer --pure
opencode debug skill --pure
opencode mcp list --pure
```

Assert:

- resolved command/data paths match installed canonical values;
- the `delegate` skill is discoverable;
- Build permission rules allow the eight gateway tools and deny decision and
  integration;
- the Codex notice and every non-Build agent have no acceptance authority;
- `claude-architect` connects through the gateway;
- project status remains empty after OpenCode creates metadata;
- no output includes inherited credentials because all config/state is
  synthetic.

Do not claim this proves safety in an arbitrary user project; gateway tests are
the acceptance-authority evidence.

- [ ] **Step 3: Add release preflight**

Release validation must require a supported OpenCode executable, print its exact
version, and run:

```bash
RUN_OPENCODE_HOST_GATE=1 npx vitest run \
  tests/runtime/opencode-mcp-host.test.ts
```

Extend `tests/validate-release.test.sh` for missing/unsupported OpenCode before
any release check. Normal `npx vitest run` may skip the external CLI gate;
release validation may not.

- [ ] **Step 4: Verify Task 7**

```bash
RUN_OPENCODE_HOST_GATE=1 npx vitest run \
  tests/runtime/opencode-mcp-host.test.ts
npx tsc --noEmit -p tsconfig.tests.json
```

Expected: real supported OpenCode discovers the project skill, permission
shape, gateway, and eight-tool surface only in the isolated fixture.

---

### Task 8: Make Host Instructions Explicit And Tombstone Codex Agents

**Files:**

- Modify: `skills/delegate/SKILL.md`
- Modify: `agents/codex-implementer.md`
- Modify: `.opencode/agents/codex-implementer.md`
- Modify: `tests/delegate-routing.test.mjs`
- Modify: `tests/lane-contract.test.mjs`
- Modify: `tests/lane-model-fallback.test.mjs`
- Modify: `tests/lane-roster.test.mjs`
- Modify: `tests/runtime/plugin-wiring.test.mjs`
- Modify: `tests/install-opencode.test.sh`

- [ ] **Step 1: Add failing Host-operation assertions**

Require one skill table:

| Operation | Claude Code | Project OpenCode |
|---|---|---|
| delegate | `mcp__plugin_claude-architect_runtime__delegate` | `claude-architect_delegate` |
| pipeline | `mcp__plugin_claude-architect_runtime__delegatePipeline` | `claude-architect_delegatePipeline` |
| review | `mcp__plugin_claude-architect_runtime__reviewCandidate` | `claude-architect_reviewCandidate` |
| decide | `mcp__plugin_claude-architect_runtime__decideCandidate` | unavailable |
| integrate | `mcp__plugin_claude-architect_runtime__integrateCandidate` | unavailable |

Require Claude entry `/claude-architect:delegate`; require OpenCode native
`skill` loading and conditional `/delegate` command wording. Remove any global
instruction that always presents the Claude-only command.

Require a Host-generated missing-transport report:

```text
DELEGATION REPORT
STATUS: unavailable
CLASSIFICATION: host-transport-unavailable
PRODUCER_STARTED: false
GUIDANCE: run install-opencode.sh --project <git-root>
```

Require OpenCode verified results to end with:

```text
STATUS: pending-human-decision
INTEGRATION: unavailable-on-opencode-compatibility-host
```

Run focused tests and record RED.

- [ ] **Step 2: Rewrite the lifecycle once with Host branches**

In `skills/delegate/SKILL.md`:

1. Preserve protocol/spec/verification rules.
2. Resolve operation names through the table.
3. Keep Codex selection structural with
   `producerPreferences: ["codex"]` and optional `producerOverrides`.
4. Claude follows review, human decision, and hash-gated integration exactly as
   today.
5. OpenCode follows delegate/pipeline and review only, reports pending status,
   and stops without manual patching or fallback.
6. Missing Host transport uses the Host-generated unavailable report; a running
   gateway/runtime result is relayed unchanged.
7. Keep only OpenCode, Pi, and Pythinker in legacy shell fallback prose; Codex
   is never a fallback.

- [ ] **Step 3: Replace both Codex agents with non-editing notices**

Claude frontmatter exposes `Read` only. OpenCode frontmatter allows read and
denies Bash, edit, glob, grep, the MCP wildcard, decision, and integration.
Neither body contains a runtime resolver, shell block, worktree/tempfile logic,
Codex argv, decision, or integration instruction.

Both return `CODEX REPORT / STATUS: unavailable` and direct the caller to the
current Host's structured delegate flow. Retain filenames for one migration
minor; remove no earlier than the next minor after upgrade tests prove no
resolver/package dependency.

- [ ] **Step 4: Move model defaults to the skill and preserve roster evidence**

Remove retired agents from model-fallback loops. Assert the skill retains GPT
5.6 Sol low-reasoning default, supported overrides, structural Codex preference,
and `producerOverrides`. Keep installer byte/authority assertions for both
notices; remove only Codex resolver/shell assertions.

- [ ] **Step 5: Verify Task 8**

```bash
node tests/delegate-routing.test.mjs
node tests/lane-contract.test.mjs
node tests/lane-model-fallback.test.mjs
node tests/lane-roster.test.mjs
npx vitest run tests/runtime/plugin-wiring.test.mjs
bash tests/install-opencode.test.sh
```

Expected: Claude retains complete authority, OpenCode ends at review, both
notices are non-editing, and no structured blocker has a Codex shell fallback.

---

### Task 9: Prove Installed Delegation, Concurrency, And No-Fallback Behavior

**Files:**

- Create: `tests/runtime/opencode-mcp-e2e.test.ts`
- Reuse: `tests/runtime/helpers/mcp-stdio-client.ts`
- Reference unchanged inherited runtime tests from Task 1

- [ ] **Step 1: Build a deterministic fake Codex**

Inside each unique temporary container, create a Node executable named `codex`
that:

- returns a deterministic version;
- records argv, prompt SHA-256, pid, cwd, and sentinel outside repositories;
- requires runtime-owned workspace-write/cwd/multi-agent controls;
- derives alpha/beta only from stdin and writes only
  `<runtime --cd>/candidate.txt`;
- emits valid Codex JSONL final/turn events;
- never claims confinement evidence.

Prefix the MCP child PATH with this directory. Skip edit cases explicitly where
the unchanged Codex adapter is not eligible.

- [ ] **Step 2: Install into the same repository later delegated**

Create committed alpha and beta repositories. Install project OpenCode into
alpha and assert its status remains empty. Start the exact installed gateway
command from a third unrelated cwd with alpha/beta sharing only the external
state root.

Build exact version-1 specs with sentinel-specific objective/context,
`writeAllowlist: ["candidate.txt"]`, `.git/**` forbidden, one Node exact-byte
verification with `expectBaselineFailure: true`, edit mode, 600000ms timeout,
Codex preference/low reasoning, and candidate-patch output.

- [ ] **Step 3: Run concurrent delegates and review both candidates**

Call gateway `delegate` concurrently with distinct progress tokens. Assert:

- both return verified candidates and distinct run ids;
- changed paths contain only `candidate.txt`;
- main checkouts remain unchanged;
- invocation prompt hashes/sentinels never cross;
- run manifests, logs, archives, worktrees, refs, patches, and review results are
  distinct;
- progress for one request does not refresh the other's inactivity timer;
- terminal cleanup removes attempt worktrees.

Call `reviewCandidate` for both and assert exact sentinel-specific patches.
Then call decision/integration directly through the gateway and require gateway
errors with no decision file, integration mutation, or child receipt. Report
both candidates pending.

- [ ] **Step 4: Add installed fail-closed cases**

Assert fake Codex invocation count does not increase for invalid spec, wrong
protocol, dirty checkout after install, missing gateway/runtime, unsupported
Codex capability, nested-delegation startup, and forbidden
decision/integration. Run calls from the unrelated cwd and prove no file appears
there.

Reference existing runtime tests for empty candidate, timeout after edit,
stale-base integration, and no confinement. Do not emulate eligibility by
changing runtime source.

- [ ] **Step 5: Add opt-in real evidence**

- `RUN_INSTALLED_CODEX_SMOKE=1`: certified macOS arm64 only; installed gateway,
  real Codex, tiny candidate, stop after review, print runtime/Codex/model/
  reasoning/confinement evidence.
- `RUN_OPENCODE_HOST_SMOKE=1`: require explicit provider/model, run real
  OpenCode in a synthetic project without `--auto`, ask it to call doctor and
  produce a no-edit invalid-spec result, and record OpenCode/runtime/protocol
  versions. Do not expose decision/integration.

Neither smoke runs by default or receives fixture credentials.

- [ ] **Step 6: Verify Task 9**

```bash
npx tsc --noEmit -p tsconfig.tests.json
npx vitest run \
  tests/runtime/opencode-gateway.test.ts \
  tests/runtime/opencode-mcp-install.test.ts \
  tests/runtime/opencode-mcp-e2e.test.ts \
  tests/runtime/attempt-runtime.test.ts \
  tests/runtime/tools.test.ts \
  tests/runtime/controlled-integrator.test.ts
```

Expected: installed gateway/runtime lifecycle, concurrent isolation, pending
candidate behavior, and all no-fallback cases pass.

---

### Task 10: Delete The Shell Surface And Align Release Documentation

**Files:**

- Delete: `scripts/run-codex-isolated.sh`
- Delete: `tests/codex-lifecycle.test.sh`
- Modify all retirement, installer, release, active documentation, changelog,
  scratchpad, and social asset files listed in the File Map

- [ ] **Step 1: Remove source/packaging after Tasks 1-9 are green**

Delete the shell wrapper and its characterization suite. Remove current Codex
adapter entries/resolvers from installer arrays, isolated-script tests, and
Claude resolver tests. Keep generic process-tree/timeout/argument/redaction/Git
hardening and legacy OpenCode/Pi/Pythinker tests unchanged.

Keep the non-executable v0.19 upgrade fixture and installer hash-owned cleanup.
Unknown installed files remain preserved conflicts.

- [ ] **Step 2: Make the retirement guard green**

Permit old path text only in historical docs, non-executable fixtures, and the
installer's delimited ownership block. Reject it in active agents, skills,
generated config, command arrays, package manifests, resolvers, README, and
current component/marketplace docs.

- [ ] **Step 3: Replace release gates**

Remove `tests/codex-lifecycle.test.sh`. After generated-runtime reproducibility
and strict Claude plugin validation, run:

```bash
node tests/legacy-codex-retirement.test.mjs
npx vitest run tests/runtime/opencode-gateway.test.ts
bash tests/install-opencode.test.sh
RUN_OPENCODE_HOST_GATE=1 npx vitest run tests/runtime/opencode-mcp-host.test.ts
npx vitest run \
  tests/runtime/opencode-mcp-install.test.ts \
  tests/runtime/opencode-mcp-e2e.test.ts
```

Do not treat platform skips or fake Codex as confinement certification.

- [ ] **Step 4: Update active docs and privacy surfaces**

Apply these facts consistently:

- Claude Code provides the complete structured Codex lifecycle.
- Project-scoped OpenCode is a compatibility path that can delegate and review
  only; gateway filtering makes decision/integration unavailable.
- OpenCode candidates remain pending and must not be manually applied.
- Project installation requires the documented CLI/OS/Git profile, creates
  exact locally excluded managed files, and stores runtime data externally.
- The installer never executes OpenCode project discovery; release Host tests
  use synthetic isolated projects.
- Global Codex MCP and native Windows project install are unavailable.
- Gateway/runtime blockers never fall back to shell editing.
- OpenCode compatibility is not first-class Host or confinement certification.

Update marketplace inventory, architecture/trust/security/threat docs, privacy
retention/removal instructions, README install/quick-start/limitations,
component inventory, and social-card wording (`OpenCode compatible`, not
`OpenCode native`). Regenerate `assets/social-preview.png` from the SVG at its
existing dimensions and inspect it visually.

Under CHANGELOG Unreleased, record gateway subset, project installation, shell
retirement, no-fallback rule, pending-only OpenCode candidates, and release
gates. In `scratchpad.md`, record historical exit 65, current repaired baseline,
and permanent regression commands.

Do not rewrite historical plans or released changelog entries.

- [ ] **Step 5: Run focused retirement/release verification**

```bash
node tests/legacy-codex-retirement.test.mjs
node tests/delegate-routing.test.mjs
node tests/lane-contract.test.mjs
node tests/lane-model-fallback.test.mjs
node tests/lane-roster.test.mjs
bash tests/install-opencode.test.sh
bash tests/claude-runtime-resolver.test.sh
npx vitest run \
  tests/runtime/plugin-wiring.test.mjs \
  tests/runtime/isolated-scripts.test.ts \
  tests/runtime/opencode-gateway.test.ts \
  tests/runtime/opencode-mcp-install.test.ts \
  tests/runtime/opencode-mcp-e2e.test.ts
bash scripts/validate-release.sh
```

Expected: no active/installed Codex shell route, known upgrades clean, unknown
files preserved, gateway subset enforced, and active claims aligned.

---

### Task 11: Complete Verification And Final Trust Review

- [ ] **Step 1: Run all mechanical gates from a supported release profile**

```bash
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.tests.json
npx vitest run
bash scripts/validate-release.sh
claude plugin validate --strict .
git diff --check
git status --short --branch
```

Expected: source/test typing, full Vitest, generated assets, installer/upgrade,
real isolated OpenCode Host gate, release validation, and strict Claude plugin
validation pass. Status lists only intended migration files plus unrelated
pre-existing user/concurrent changes.

- [ ] **Step 2: Review final bytes against every trust claim**

Prove from diff and command output:

```text
Claude Code retains full decision and integration authority.
OpenCode sees exactly eight gateway tools and cannot forward decision/integration.
Project installation leaves exact Git porcelain status empty.
Installer never executes OpenCode project discovery or prints resolved config.
Every config activation points to a complete immutable gateway/runtime.
Symlink, containment, lock, journal, tracked-file, and upgrade conflicts fail closed.
Both Codex notices are non-editing and no shell fallback remains.
Concurrent specs retain separate prompts, runs, worktrees, logs, archives, and patches.
OpenCode candidates remain pending and main checkouts remain unchanged.
Known released wrappers are removed by hash; unknown files are preserved.
AttemptRuntime, protocol, Producer policy, and certification did not change.
```

Any false statement returns to its owning task.

- [ ] **Step 3: Request a fresh independent review**

Give a read-only reviewer the approved design, this plan, full diff, exact test
output, and support profile. Require findings first on gateway bypass,
JSON-RPC/process handling, installer identity/recovery, same-project cleanliness,
OpenCode project-execution risk, no-fallback coverage, and claim honesty. Fix
every Critical/Important finding and rerun affected plus full gates.

- [ ] **Step 4: Commit only if explicitly authorized**

Inspect `git status`, `git diff`, and `git log --oneline -10`; stage only this
migration's files. Preserve unrelated `AGENTS.md`, CodeRabbit, concurrent
commits, and user changes. Do not amend, add generated-by footers, push, tag, or
publish unless separately requested.

## Plan Self-Review Checklist

- [ ] Current `--lane-mode edit` behavior is characterized as green before
  deletion; historical exit 65 is not misrepresented as current.
- [ ] Gateway filtering, not OpenCode permission ordering, enforces the
  decision/integration boundary.
- [ ] Gateway tests cover discovery, direct-call bypass, malformed/oversized
  protocol, concurrency, progress, child failure, and process cleanup.
- [ ] Project install is tested in the same Git repository later delegated and
  leaves exact porcelain status empty.
- [ ] Exact local excludes hide only installer-owned paths.
- [ ] Installer never runs OpenCode project config/agent/skill/MCP/run surfaces.
- [ ] Real OpenCode discovery occurs only in an isolated synthetic repository.
- [ ] Config activation references only complete immutable bytes and journal
  recovery never guesses through contradictory evidence.
- [ ] Legacy failures map to current characterization or retained runtime tests:
  wrong cwd, zero edit, timeout after edit, dirty checkout, stale base, protocol
  mismatch, missing runtime, nested delegation, and ineligibility.
- [ ] Concurrent evidence covers prompts, ids, worktrees, logs, archives,
  patches, progress, and main-checkout isolation.
- [ ] OpenCode docs stop at pending review and never imply handoff/manual apply.
- [ ] Source and test TypeScript are both type-checked.
- [ ] Active marketplace/privacy/threat/architecture/social/readme/changelog
  surfaces agree on support and limitations.
- [ ] No trusted runtime behavior, protocol, Producer policy, or certification
  changed.
- [ ] No placeholder, silent release skip, broad ignore, unsafe cleanup, or
  implicit follow-up remains.
