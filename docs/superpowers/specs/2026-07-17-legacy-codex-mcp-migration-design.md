# Legacy Codex MCP migration design

Date: 2026-07-17
Status: Approved direction, isolated OpenCode profile

## Decision

Retire the prose-driven Codex shell edit route after its structured replacement
is proven. Claude Code continues to use the packaged MCP server and retains the
complete delegation, review, human-decision, and Controlled Integration flow.

OpenCode does not receive project-root configuration. Instead,
`install-opencode.sh --project <root>` creates an external profile bound to the
canonical Git worktree and prints one fixed launcher path. The launcher starts
OpenCode with isolated HOME/XDG/config/data/cache/state roots, disables project
configuration and instruction discovery, disables external/Claude skills and
default plugins, denies every built-in filesystem/search/process/mutation tool,
validates the effective agent before every run, and allows no caller-selected
config, cwd, agent, permission, plugin, attach, or `--auto` option.

The profile exposes the existing MCP runtime through a narrow stdio gateway.
Its total raw wire tool surface is:

- `runAuthorizedPipeline`
- `reviewCandidate`
- `doctor`
- `projectRead`
- `projectList`
- `projectSearch`

The immutable OpenCode MCP server key is exactly `architect`. OpenCode 1.18.3
therefore presents only these four model-facing Build names:

- `architect_runAuthorizedPipeline`
- `architect_projectRead`
- `architect_projectList`
- `architect_projectSearch`

Raw `doctor` and `reviewCandidate` are filtered calls available only to the
launcher-owned MCP client and never become OpenCode/model tools.
`runAuthorizedPipeline` is a no-argument gateway-local proxy that atomically
consumes the descriptor's one pipeline authority and injects the private stored
spec into the child runtime's `delegatePipeline`; the runtime tool/schema/spec
never enter the model surface. Its model-facing result is a fixed minimal
terminal classification with no child payload, spec-derived summary, command,
finding, evidence, or diagnostic. The private observation receives only the
closed launcher-validation projection defined below, never the full child
result. The last three tools are gateway-local, read-only
inspection of the clean launcher's captured `HEAD` tree through hardened Git
object commands. They accept no repository or revision argument, never read a
working-tree path, reject symlink-mode entries, and return bounded data. The
runtime's four live-worktree Git read tools are not exposed. OpenCode's built-in
`read`, `glob`, and `grep` tools are denied because
OpenCode 1.18.3 performs lexical external-directory checks before following
file symlinks and its `read` tool automatically injects nearby `AGENTS.md`,
`CLAUDE.md`, or `CONTEXT.md` content.

It cannot discover or forward `decideCandidate`, `integrateCandidate`, or an
unknown future tool. OpenCode compatibility ends at a frozen, independently
verified and reviewed candidate. Acceptance and integration remain Claude
Code-only in this scope. A pending OpenCode candidate must not be manually
applied or described as accepted.

## Why project-local config was rejected

A managed `.opencode/opencode.jsonc` and permission rules are not an authority
boundary:

- `--pure` still allows discovered project custom tools to be imported.
- Project agents/config loaded after global rules can override permissions.
- `opencode run --auto` approves operations left at `ask`.
- The interactive "Allow always" choice persists an approval within the
  process and can affect later agents/sessions.
- An ordinary Build agent with process or edit tools can bypass a gateway by
  starting the installed unfiltered runtime, changing ignored config, or
  editing the checkout directly.

An MCP filter constrains only its connection. It is useful defense in depth but
cannot make an ordinary project OpenCode process pending-only. The fixed
external launcher removes project/global discovery and mutation/process tools
before the model starts, while the gateway independently limits the runtime
surface.

The exact 1.18.3 source also shows that `OPENCODE_CONFIG_DIR` is an additional
discovery directory, not a replacement for XDG global config or
`$HOME/.opencode`. The profile therefore points `OPENCODE_CONFIG_DIR` and
`$XDG_CONFIG_HOME/opencode` at the same read-only directory inside the current
immutable release, requires isolated `$HOME/.opencode` to be absent, rejects
unsupported auth types and active account/organization state, and checks
system-managed config/preferences before any OpenCode process. A discovered
source is never made safe merely by checking the merged config after plugin code
could have loaded.

In the same exact source, `Instruction.systemPaths()` skips project
`AGENTS.md`/`CLAUDE.md`/`CONTEXT.md` discovery when
`OPENCODE_DISABLE_PROJECT_CONFIG=1`. Its separate dynamic
`Instruction.resolve()` path does not honor that flag, which is why denying the
built-in `read` tool remains mandatory. The real 1.18.3 Host gate sends a prompt
to a local fake provider and inspects the complete captured system input, proving
that project/global/home/managed sentinel instructions are absent rather than
merely observing that their side effects did not execute.

## Current evidence

The initial investigation found a composed command that failed before Codex
started because both legacy agents passed raw `--sandbox` and `--cd` options
that the wrapper rejected. That failure is historical at current `main`:
commits `2652ddf` and `d466f8e` moved those controls behind wrapper-owned
`--lane-mode edit` and tightened hidden-option rejection.

These checks now pass:

```text
bash tests/codex-lifecycle.test.sh
node tests/lane-contract.test.mjs
npx vitest run tests/runtime/isolated-scripts.test.ts
```

The repaired shell route remains migration debt:

- Agent prose owns prompt/final tempfiles, worktree selection, timeout
  coordination, diff collection, verification order, and cleanup.
- Claude Code and OpenCode duplicate a long behavioral contract instead of
  submitting one canonical Delegation Spec through an executable interface.
- Shell reports are not durable Attempt Results or Candidate Artifacts.
- A caller can still implement the lifecycle incorrectly even when individual
  fragments are tested.

Migration tests characterize the current `--lane-mode edit` route before
deleting it. They must not present the superseded exit-65 command as current
RED.

## Scope

This design changes legacy transport, OpenCode profile packaging, and Host
exposure only:

- Keep Claude Code Codex delegation on the existing MCP lifecycle.
- Build a complete immutable runtime/profile closure outside the repository.
- Add a fixed, project-bound OpenCode launcher with `auth`, `doctor`, `run`, and
  `review` operations only.
- Add a stdio allowlist gateway in front of the unchanged runtime.
- Give the OpenCode Build model only no-argument
  `architect_runAuthorizedPipeline` and the three `architect_project*` snapshot
  tools. A launcher-owned trusted MCP stdio client, not an OpenCode agent,
  invokes purpose-bound `doctor` and `reviewCandidate`. Deny the Build agent all
  built-in read, search, shell, edit, write, patch, task, web, skill, and
  external-path capabilities.
- Move OpenCode Codex delegation from shell agents to structured MCP calls.
- Remove release-owned legacy project-install files during upgrade without
  writing new project or Git metadata.
- Preserve the separate `--global` Pi/Pythinker installation surface, replace
  its owned Codex agent with the read-only tombstone, and hash-remove its owned
  copied Codex wrapper. Modified or user-owned global Codex files remain
  explicit conflicts.
- Remove the Codex shell wrapper, active resolvers, and fallback behavior.
- Add profile, launcher, gateway, Host, lifecycle, upgrade, and retirement
  release gates.

## Non-goals

- No changes to `AttemptRuntime`, runtime recovery, pipeline behavior,
  verifier behavior, Candidate Artifact semantics, Host Decision, Controlled
  Integration, protocol schemas, capability policy, model attestation, or
  confinement behavior.
- No OpenCode decision or integration support.
- No cross-Host transfer of an OpenCode run into Claude Code state.
- No ordinary project-local or global Codex MCP configuration.
- No first-class OpenCode Host certification.
- No native Windows profile support in this change.
- Initial profile Host tuples are exactly macOS arm64 with
  `opencode-darwin-arm64@1.18.3` and glibc Linux x64 with
  `opencode-linux-x64-baseline@1.18.3`. The baseline package is selected for all
  supported Linux x64 CPUs; the AVX2-dependent package is never selected. macOS
  x64, Linux arm64/musl, Windows, and unknown OS/arch/libc tuples fail
  unavailable before profile mutation or OpenCode launch.
- Installation provisions the selected direct platform package from the checked
  host-gate lockfile into isolated external temporary state with lifecycle
  scripts disabled, validates locked registry URL/SRI/package/version and binary
  SHA-256, then copies only that direct binary into the immutable release. It
  never executes or records a user-global `opencode` shim. Reuse of an exact
  existing immutable release needs no network; first provision or a new release
  may contact only lockfile-pinned registry URLs and fails before activation on
  unavailable or changed bytes.
- No external OpenCode plugins or inherited provider/config environment in the
  initial profile. Supported provider ids are exactly `anthropic`, `openai`,
  `opencode`, and `openrouter`; users authenticate them separately through the
  profile launcher's API-key-only helper. Every provider/model/variant outside the checked release
  catalog fails unavailable before OpenCode starts.
- No expansion of Producer, model, platform, or confinement certification.
- No implementation of unrelated runtime deadline, salvage, lease, recovery,
  reviewer-focus, or tracked-symlink proposals.

Known runtime gaps remain separate work and must not be described as fixed.

## Trust boundaries

### Existing runtime

`src/mcp/tools.ts`, `src/mcp/server.ts`, and `AttemptRuntime` remain the
lifecycle sources of truth. The runtime alone owns repository identity,
serialization, preconditions, Producer routing/confinement, attempt worktrees,
process supervision, candidate freeze/hash/archive, verification, cleanup,
decision records, and Controlled Integration.

The profile installer, launcher, prompt, and gateway do not reproduce those
steps or synthesize successful results.

### OpenCode process

OpenCode core is a compatibility Host, not a trusted acceptance authority. The
Build model can inspect captured clean `HEAD` only through the three
`architect_project*` tools and call only no-argument
`architect_runAuthorizedPipeline`. OpenCode can
never call `doctor` or `reviewCandidate`; the trusted launcher MCP client can
call one of them only for a matching descriptor purpose. The Build agent
cannot receive built-in read/glob/grep/shell/edit/write/patch/task/web/skill or
external-directory permissions. It cannot load project `.opencode`, root
OpenCode config, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, project
plugins/tools/agents/skills, the user's global OpenCode/Claude/agent config, or
inherited external skills.

The launcher sets and verifies at least:

```text
OPENCODE_DISABLE_PROJECT_CONFIG=1
OPENCODE_DISABLE_EXTERNAL_SKILLS=1
OPENCODE_DISABLE_CLAUDE_CODE=1
OPENCODE_DISABLE_DEFAULT_PLUGINS=1
OPENCODE_PURE=1
OPENCODE_DISABLE_AUTOUPDATE=1
OPENCODE_DISABLE_MODELS_FETCH=1
OPENCODE_MODELS_PATH=<current-release>/models.v1.json
OPENCODE_DISABLE_LSP_DOWNLOAD=1
OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=1
OPENCODE_CONFIG_DIR=<current-release>/xdg-config/opencode
HOME=<profile>/home
XDG_CONFIG_HOME=<current-release>/xdg-config
XDG_DATA_HOME=<profile>/xdg-data
XDG_CACHE_HOME=<current-release>/xdg-cache
XDG_STATE_HOME=<profile>/xdg-state
TMPDIR=<profile>/tmp
```

`OPENCODE_CONFIG_DIR` must equal the global path OpenCode derives from
`XDG_CONFIG_HOME` and both must be inside the hash-verified read-only release;
separate additive or writable roots are invalid. The launcher also
requires isolated `$HOME/.opencode`, system-managed OpenCode config, macOS
managed preferences, well-known auth records, and active account/organization
config to be absent. It passes `--pure`, a fixed `--agent build`, fixed
canonical `--dir`, and no `--auto`. It removes inherited `OPENCODE_CONFIG`,
`OPENCODE_CONFIG_CONTENT`, `OPENCODE_AUTH_CONTENT`, `OPENCODE_PERMISSION`,
plugin/config override flags, delegation markers, provider secrets, and
unrelated credential variables. Generated config disables LSP/formatter
execution, and the environment disables project file watching and automatic
updates/downloads that are not required by the fixed flow.

OpenCode provider credentials are created under the profile's XDG data root by
the launcher's bounded `auth --provider <id>` operation without spawning
OpenCode. A provider id must be in the exact four-provider allowlist. The
launcher reads one bounded API key from an echo-disabled controlling TTY, never
argv/stdin redirection/environment, and writes only the pinned OpenCode 1.18.3
record `{type:"api",key}` using no-follow same-directory mode-`0600` temporary
creation, file fsync, atomic rename, parent fsync, and Windows current-user ACL.
The shared profile lock excludes profile operations; malformed existing bytes,
unknown providers/fields, symlinks, owner/mode/ACL drift, or non-TTY use fail
without changing the store. OAuth, `wellknown`, metadata, arbitrary URL/method,
and raw auth argv are unsupported. Before any model run, the launcher strictly
parses the store and requires one exact API record for the selected provider.
Credentials are never copied from the user's normal OpenCode store or logged.

OpenCode 1.18.3 provider resolution is executable code outside model tool
permissions: an effective `model.api.npm` beginning with `file://` is imported
directly, while any key outside its bundled-provider table reaches `Npm.add` and
then a dynamic import. The compatibility profile closes that path with a
canonical, manually seeded, human-reviewed `models.v1.json` that is itself the
authority, never the official binary's non-reproducible embedded snapshot or
live models.dev data. Its provenance records models.dev commit
`1eb0b8c8e17ffddd89f53b2a3e426777dc560542`, the source pinned by OpenCode
1.18.3's Nix build, but runtime trust derives from the checked local bytes and
hash. It contains only the four supported providers and exact provider/model
metadata, variants, API endpoints, and SDK specifiers accepted by the release. Allowed SDK
specifiers are exactly `@ai-sdk/anthropic`, `@ai-sdk/openai`,
`@ai-sdk/openai-compatible`, and `@openrouter/ai-sdk-provider`; `file:`, URL,
path, version/range, alias, workspace, Git, and every other package specifier are
invalid. The compatibility manifest pins the catalog hash, provenance, and every
permitted provider/model/variant, endpoint origin, and SDK tuple.

`OPENCODE_MODELS_PATH` points to that immutable file and
`OPENCODE_DISABLE_MODELS_FETCH=1`; no launcher command accepts `models
--refresh`. Generated config has no provider/model definitions or endpoint/npm
overrides and enables only the four providers present in the catalog. External
and default plugins remain disabled. The release also contains precreated mode-`0555` empty
`xdg-cache/opencode/bin` and `xdg-cache/opencode/packages` directories under a
read-only cache root. Thus an accidentally reached `Npm.add` cannot create its
`<cache>/packages/<specifier>` target. Launch preflight rejects any cache entry,
package metadata, `node_modules`, import hook, `NODE_PATH`, npm/Bun override, or
catalog/config drift. Exact-binary no-model and fake-provider runs must succeed
with that cache byte-identical and prove no package acquisition or file import.

The launcher parses `--model` and optional `--variant` against the checked
catalog before OpenCode starts and binds the exact tuple, catalog hash, expected
SDK specifier, and endpoint origin into the descriptor. After validating the
selected provider's API record, run preflight captures only that provider's
bounded `opencode models <provider> --verbose` projection under the isolated
effective config and requires exact equality with its checked catalog subset.
`doctor` validates static catalog/config/hash/cache invariants without requiring
all providers to be active. A merely syntactically valid model or provider is
unavailable.
The Producer is fixed to Codex by gateway validation of
`producerPreferences: ["codex"]`. Before profile mutation, the installer uses
the existing platform resolver to resolve and probe Codex, Node, and Git. It
canonicalizes every command/prefix-argument executable, rejects symlinks/special
files/identity ambiguity, records path/file identities, byte hashes and versions,
and requires the current Codex capability report to be edit-eligible under the
unchanged confinement registry.

`CODEX_HOME` is exactly canonical inherited `CODEX_HOME` when non-empty,
otherwise `<real host home>/.codex`. The installer requires that directory and
its `auth.json` to be same-user, no-follow, and non-public; `auth.json` must be a
singly linked regular file. It records only path/identity/mode, never credential bytes or hashes. A
missing/unsafe/unauthenticated store fails before profile mutation. Every run
revalidates those identities.

The launcher discards inherited PATH after preflight. It constructs an ordered,
collision-checked PATH only from canonical parent directories of the recorded
Codex, Node, and Git executables plus exact verification executables that the
human-authorized spec caused the launcher to resolve and identity-bind before
model start. Any writable-path identity race, duplicate command-name ambiguity,
resolution mismatch, or runtime Codex capability-report mismatch fails. The
runtime child receives this PATH, the exact canonical `CODEX_HOME`,
`CLAUDE_PLUGIN_DATA=<profile>/architect-data`, and a separately constructed
minimal environment, not the OpenCode process environment wholesale.

### Stdio allowlist and snapshot gateway

The gateway is a trusted Host-exposure and read-only snapshot adapter, not a
second attempt runtime. It spawns sibling `runtime/bootstrap.mjs` with
executable-plus-argv and enforces a fixed operation allowlist:

1. Reduce every successful child `tools/list` response according to the claimed
   one-shot descriptor purpose: run exposes `runAuthorizedPipeline` plus the three
   local snapshot schemas; doctor exposes only `doctor`; review exposes only
   `reviewCandidate`; install probes expose the minimum explicit subset.
2. Reject every inbound `tools/call` outside those six names before any
   execution or forwarding.
3. For runtime repository-taking tools, require the exact profile-bound
   canonical checkout path in arguments, recheck clean `HEAD` against the
   descriptor's captured OID immediately before forwarding, and require every
   returned candidate base OID to equal that capture.
4. Do not expose child `delegatePipeline`. On the first no-argument
   `runAuthorizedPipeline` call, atomically consume the descriptor's pipeline
   authority before forwarding, load and revalidate the private stored spec,
   require exactly `producerPreferences: ["codex"]`, and synthesize the exact
   unchanged runtime input `{checkoutPath, spec, protocolVersion}`. The checkout
   is the bound canonical path, `spec` is the stored validated object, and
   `protocolVersion` is the release-bound application `PROTOCOL_VERSION` imported
   from `src/protocol/versions.ts` (`1.1.0` for the current release), not the MCP
   wire version. Concurrent or subsequent calls fail before a second baseline
   command/Producer can start.
5. For local snapshot tools, use only the launcher's captured commit OID and
   bound repository, reject caller repository/revision input and symlink tree
   modes, and read blobs through the hardened Git runner with
   `GIT_NO_LAZY_FETCH=1` and `GIT_NO_REPLACE_OBJECTS=1` so partial clones fail
   rather than starting a remote helper and replacement objects cannot alter the
   captured tree. Preflight rejects any `refs/replace/*` or legacy
   `$GIT_DIR/info/grafts` source.

Unknown future tools are denied by default. Separate parent-to-child and
child-to-parent pending-id maps distinguish requests/responses, allow the same
id once in each direction, reject duplicate outstanding ids per direction, and
identify only the matching `tools/list` response for filtering.

Non-tool protocol is allowlisted too. Parent requests are limited to
`initialize`, `ping`, `tools/list`, and `tools/call`; parent notifications to
`notifications/initialized` and `notifications/cancelled`; child requests to
`ping`; and child notifications to the exact progress method used by the
runtime. OpenCode 1.18.3's initialize request contains exact client capability
`{roots:{}}`; the gateway validates and terminates that declaration, then sends
an empty client capability object to the runtime child. The pinned MCP server
advertises `tools.listChanged:true`; the gateway accepts that exact child value
but returns only `{tools:{}}` to OpenCode. This normalization grants neither
side a roots or list-change operation. `roots/list`,
`notifications/roots/list_changed`, `notifications/tools/list_changed`, and all
other resources, prompts, roots, sampling, elicitation, completion, logging
control, list-change, and unknown future methods/capabilities remain denied in
either direction. Correlated responses, errors, ids, and progress tokens for
allowed methods pass through structurally unchanged. Local tool responses obey the same
JSON-RPC id and byte limits. The gateway enforces bounded lines,
aggregate queued bytes, outstanding request counts, snapshot entries/blobs/
matches, and stderr; honors stream backpressure; keeps stdout protocol-only;
forwards termination; escalates after the existing bootstrap grace; and waits
for child exit. Malformed protocol, queue flood, write failure, child failure,
Git snapshot mismatch, or ambiguous shutdown fails closed.

Both initialize legs require MCP protocol version `2025-11-25`, the exact latest
version pinned by the repository's `@modelcontextprotocol/sdk@1.29.0`. The
gateway advertises and accepts only that literal, verifies the correlated child
initialize result returns it, and rejects fallback negotiation, an older
otherwise-supported SDK version, or any future value.

OpenCode and the gateway's runtime child are each started through a packaged
parent-death watchdog. Before the model or runtime call is enabled, the watchdog
fsyncs its own and its child PID/start-token/process-group identities into the
operation record. It polls the exact parent identity, terminates the complete
child process group on parent exit or start-token mismatch, escalates after the
existing grace, and waits for child exit. Lock reclamation checks all recorded
watchdog/child identities; a surviving or ambiguous orphan keeps the operation
busy and is never signaled by a later installer/launcher. SIGKILL of launcher or
gateway is an adversarial release gate.

For each gateway subprocess within one locked launcher operation, the launcher
precreates a bounded no-follow mode-`0600` one-shot descriptor under profile
state. It binds profile/release/project hashes, operation/subprocess purpose,
captured commit when applicable, a mode-`0600` canonical authorized-spec file
and hash, observation path identity, random nonce, creation/expiry, and the held
operation-lock identity. Immutable
OpenCode config contains no per-run OID or observation path; the launcher passes
only descriptor path and nonce in the fixed process environment. The gateway
opens it no-follow, verifies every binding, atomically claims it for one gateway
process, and refuses reuse/reconnect ambiguity. The spec bytes and authority
fields are never copied into OpenCode argv, environment, prompt, session, tool
schema, tool arguments, or tool results. The descriptor has one atomically consumed pipeline
authority and cumulative atomic snapshot entry/blob/match/byte budgets shared
across all calls; concurrency cannot exceed them. The run descriptor's private
run observation records a strict canonical projection, not raw prompts, full
tool payloads, or the full `PipelineResult`: allowed tool name and correlation
digest; pipeline status and nullable failure classification; run id; final
candidate commit; final attempt candidate base/commit/tree/manifest identity and
verification state; final verification pass/failure classifications and bounded
command-outcome metadata without stdout/stderr; gate reasons; and structured
review round/finding/disposition metadata. Unknown fields fail validation.

After OpenCode exits, the launcher validates and seals that run observation. If
it is eligible for artifact inspection, the launcher creates a separate review
descriptor and mode-`0600` review observation. The direct MCP client writes only
the exact requested run id, tool/correlation digest, bounded
`reviewCandidate.changedPaths` projection, and recomputed manifest hash. It
cannot append to or replace the run observation. The launcher then correlates
both immutable records by profile/release/project/run/final commit/base/tree/
manifest identities and fsyncs a third closed composite result envelope. Model
prose is labeled untrusted and cannot set status. Only that composite may say
`pending-human-decision`; missing, ambiguous, mismatched, unreviewed, or
allegedly accepted/integrated records fail closed.

Pending eligibility requires a non-`failed` pipeline result with null failure,
a verified final candidate, non-null passing final verification, final candidate
commit/base/manifest hashes matching the archived attempt and subsequent
artifact inspection, and complete structured reviewer rounds. Both
`decision-ready` and `human-decision-required` remain pending only; the envelope
preserves the exact pipeline status, gate reasons, findings, dispositions,
verification outcomes, and artifact evidence. A failed/unverified/mismatched
pipeline cannot be made pending-success merely because `reviewCandidate` can
read its archive.

This correlation uses existing fields only: private `PipelineResult.runId`,
`finalCandidateCommit`, and `attempt.candidate` OIDs/base/manifest must agree;
the launcher invokes `reviewCandidate` with that exact run id, recomputes the
existing manifest hash from its returned ordered `changedPaths` using the
runtime's current JSON/SHA-256 rule, and requires equality. The review output is
not claimed to expose candidate OIDs; its trusted archive loader plus exact run
id and changed-path hash bind artifact inspection to the pipeline archive.

### Fixed launcher

The launcher is the only supported OpenCode entry. It accepts:

- `auth --provider <id>`: require one of the four checked provider ids, read one
  API key from an echo-disabled controlling TTY, and durably update only the
  isolated profile auth store. It starts no OpenCode/model/network/browser
  process and accepts no OAuth method, key argv, URL, or redirected stdin.
- `doctor`: no model; validate immutable bytes, environment, project identity,
  clean status, effective Build permissions/tool set, gateway connection, and
  a launcher-client direct `doctor` tool call.
- `run --model <provider/model> [--variant <value>]`: read and strictly validate
  a bounded human-authorized canonical version-1 Delegation Spec JSON from
  launcher stdin; require the exact model/optional variant, SDK, endpoint, and
  catalog hash tuple; persist the spec privately; then close that input. Invoke
  `opencode run --format json` with fixed profile flags, one immutable reviewed
  literal message (`Execute the single authorized pipeline operation, wait for
  its terminal result, then stop. Do not claim acceptance or integration.`),
  and child stdin ignored; no spec byte becomes OpenCode input.
  Validate the run observation, perform the separate review call when eligible,
  and emit only the launcher-composed correlated envelope rather than model
  claims.
- `review --run-id <id>`: call the purpose-bound review tool directly through
  the launcher MCP client without OpenCode or a model.

The launcher MCP client starts the packaged gateway through the same watchdog,
uses one purpose-bound descriptor, and implements only bounded `initialize`,
`notifications/initialized`, `tools/list`, one exact `tools/call`, correlated
response/error, and shutdown. Doctor allows only `doctor` with `{}`; review
allows only `reviewCandidate` with the validated run id. It rejects every
server-initiated request, unexpected notification/capability/method/id, second
call, oversized frame, timeout, or child leak. OpenCode effective config and
built-in denial use exact `debug config` and `debug agent build`; `mcp list`
checks configuration/connection. The real fake-provider request captures the
actual model-facing definitions and proves the exact four namespaced Build tools
under immutable server key `architect`,
because OpenCode 1.18.3 `debug agent --tool` does not include MCP tools.

No operation accepts arbitrary OpenCode or auth argv, URL, cwd, config, agent,
plugin, permission, attach/server, sharing, auto-approval, or command options.
One Host
operation lock serializes install/recovery/auth/doctor/run/review. A second
same-profile operation fails with `profile-busy` before OpenCode starts. Every
launch revalidates the launcher, current pointer, release manifest, project/Git
identity, release-local OpenCode executable hash/version, Node, every discovery
root,
auth/account state, config, generated agent prompt, permissions, gateway, clean
checkout, and captured inspection commit before a model starts.

Profile Host supervision is separate from the runtime's 30-minute per-process
supervisor ceiling. Auth/doctor/review each have a fixed ten-minute whole-
operation bound. Run has a fixed six-hour whole-operation bound and a
profile-only parent-death-aware supervisor. Before launch, a conservative
worst-case estimator over the authorized spec's attempt timeout, verification
commands, review rounds/reviewer count, and current fixed role retry counts must
fit that bound; otherwise the compatibility Host is unavailable. Deadline expiry
terminates the complete OpenCode/gateway/runtime tree and never falls back.

### Claude Code Host

`/claude-architect:delegate` remains the complete interface and uses
plugin-scoped `mcp__plugin_claude-architect_runtime__*` tools. Claude may review,
present the decision to the human, record it, and integrate an accepted
hash-matched candidate. The legacy Claude Codex agent becomes a read-only
migration notice. No runtime blocker falls back to it or the shell wrapper.

## Profile layout and identity

The default root is:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/claude-architect/opencode-profiles/<project-key>/
```

`project-key` is a SHA-256 over a versioned canonical tuple containing the
canonical worktree root, canonical Git common directory, and canonical
per-worktree Git directory. The profile manifest records the no-follow identity
and link count of every root and the worktree's `.git` directory or gitfile
binding, so a moved/replaced/relinked path or changed Git indirection fails
until reinstall.

The profile contains:

```text
profile.json                 bound project and profile identity
current.json                 atomically activated immutable release
launcher.mjs                 stable Node-compatible fixed launcher
releases/<version>/<hash>/   immutable runtime, gateway, config, model catalog, cache, prompt, manifests
architect-data/              MCP run archives/worktrees/locks
xdg-data/opencode/           profile auth and OpenCode session data
home/ xdg-state/ tmp/
locks/ transactions/ operations/ backups/
```

`launcher.mjs` is a release-independent format-v1 bootstrap: it accepts only
the fixed public grammar, validates `profile.json`/`current.json`, and invokes
the current release's generated CLI. First install creates its exact checked
bytes; every format-v1 upgrade requires byte/mode identity and never replaces
it. A future launcher-format change requires a separate migration design. This
keeps rollback/current-pointer activation independent of launcher bytes.

Install and launch reject effective uid 0. All roots are external to the
repository and installed release, created with
restrictive permissions, and rejected when symlinked or type/identity changed.
Link count is part of each no-follow identity; protected regular files must have
link count one except during a checked atomic hard-link transition. New install,
`auth` receive no new project file, local exclude, Git config, index entry, ref,
object, worktree entry, or metadata. `doctor`, `review`, and `run` leave the main
worktree bytes, status, index, `HEAD`, config, and non-runtime refs unchanged.
Those operations start the unchanged runtime, whose startup recovery may clean
runtime-owned stale worktree administration. A successful `run` additionally
creates Git objects, a candidate ref under
`refs/claude-architect/candidates/`, and temporary per-attempt worktree
administration. Tests inventory those exact runtime-owned mutations and require
temporary worktree metadata to be cleaned at terminal completion. Doctor and
review are byte-identical when no runtime recovery is pending.

The co-located config directory is part of the immutable release, owned by the
launching non-root uid, mode `0555`, and contains only a same-owner mode-`0444`
`opencode.jsonc` with `$schema` already present.
OpenCode 1.18.3 treats inability to create `.gitignore`, package metadata, or
dependencies there as non-fatal; the exact real-Host gate proves that behavior
and that no extra file appears. Any writable config root, extra entry,
`tool(s)`, `plugin(s)`, `agent(s)`, `skill(s)`, `command(s)`, instruction file,
symlink, special file, or multiply linked protected file blocks launch.
Isolated `$HOME/.opencode` must not exist. The config bytes/modes and every
discovery-root identity are revalidated before and after every no-model probe
and before model start.

## Immutable release hashing

Generated config, prompt, and release-local CLI/gateway bindings contain the
final release path, so release naming must avoid a circular hash. The stable
launcher contains none of those values:

1. Build a canonical deployment-key body over every path-independent immutable
   install-manifest input: plugin/version/tool-policy, bound project identity,
   executable identities, static asset hashes/modes, compatibility/model/
   retirement manifests, and generated templates containing a literal release-
   root token. No identity-dependent field may exist only in the later manifest.
2. `deploymentHash` is SHA-256 of that tokenized body.
3. Derive `releases/<version>/<deploymentHash>/` and render exact final bytes.
4. Build a canonical install-manifest body containing deployment hash, final
   path, every rendered byte hash/mode, the already key-bound project/executable
   identities, expected immutable-config hash, and prompt/gateway policy.
5. `installManifestHash` is SHA-256 of that body before adding only its own
   field.

`current.json` and the immutable install manifest record both hashes;
`profile.json` separately records the release-independent stable-launcher hash.
The stable launcher records no release path, release version, deployment hash,
or install-manifest hash. Every launch rehashes the tokenized deployment body
and final manifest/bytes. An existing release is reused only on exact equality;
immutable bytes are never updated in place.

## Installation and recovery

`scripts/install-opencode.sh` becomes a small Node bootstrap for the generated
profile CLI. It uses the same hardened executable-plus-argv Git policy as
`src/git/git-exec.ts`, neutralizing external diff/textconv, hooks, fsmonitor,
filters, and inherited `GIT_*` identity redirection.

### New install

A new install requires an existing canonical non-bare Git worktree with `HEAD`
and an exact clean status. It performs no project writes. It validates every
source, destination, executable, profile ancestor, stage, lock, journal,
backup, data root, and identity with no-follow canonical containment.

Before profile mutation, the installer copies the checked host-gate package and
lockfile to external temporary state and runs exact `npm ci --ignore-scripts
--no-audit --no-fund` with isolated HOME/cache/user/global config, no npm
credentials/hooks/proxies, and only the lockfile's canonical registry URLs. The
selector opens the exact direct platform-package binary no-follow, verifies
package identity/version/SRI and its recorded SHA-256, executes only bounded
`--version`/Host probes, and copies those verified bytes into the rendered
release. Temporary dependency bytes are never part of profile auth/data or the
project. Any network, lock, extraction, identity, or digest ambiguity leaves
`current.json` and project bytes unchanged.

### Upgrade from the legacy project installer

The current project installer may have left untracked agents, skill, and
scripts that make the checkout dirty. Before rejecting dirt, the new installer
may classify only exact legacy paths whose bytes/modes match a checked
release-owned inventory generated from every project-installer tag from
`v0.5.0` through `v0.19.0`, including patch tags. The inventory pins each tag's
peeled commit OID through a separate checked tag-to-OID allowlist; generation
fails if a fetched/moved tag no longer peels to that independent value. Every
project-installed asset is inventoried, not only the
Codex wrapper. Releases older than the first project installer are not inferred
or deleted.

The human-reviewed OID allowlist is immutable generator input, never generated
from current tags. Asset reads use only `git show <allowlisted-oid>:<path>` with
`GIT_NO_REPLACE_OBJECTS=1` and no lazy fetch. Pre/post generation rejects loose
or packed `refs/replace/*`, legacy `.git/info/grafts`, tag/OID drift, and
replacement-base environment so destructive ownership can never derive from a
movable/ref-replaced object.

Tracked, ignored-user-owned, modified, unknown, symlinked, special, or unrelated
paths are preserved and block activation. Release-owned untracked files are
backed up externally and removed transactionally. Empty plugin-owned directories
may be removed after no-follow identity checks. No broad recursive deletion is
allowed.

The same pinned destination hashes classify prior `--global` installs. Global
upgrade removes only an exact owned Codex wrapper and replaces only an exact
owned Codex agent with a checked canonical tombstone asset that is built before
the migration transaction; it continues to install the separately
supported Pi/Pythinker assets. A modified/user-owned Codex file is preserved and
reported, and no active installed resolver may reference it.

Global migration uses the same transaction primitives under an external
`opencode-global-migrations/<destination-key>/` root, with its own no-follow
operation lock, journal, exact external backups, failpoint recovery, and
destination identity. All conflicts are found before mutation. Mutation removes
the exact owned Codex wrapper first and fsyncs a forward-only commit marker,
then atomically publishes the tombstone, then updates other exact managed
assets. Before that marker, ordinary failure may restore the complete prior set.
After it, neither ordinary failure nor crash recovery may restore the wrapper:
recovery must finish the complete new global set or remain explicitly
`recovery-required` with the Codex route unavailable. Thus no post-commit state
contains an executable owned shell route. Global and project/profile locks are
never nested.

The post-migration surfaces are exact. Project mode installs no `.opencode`
asset and removes every exact-owned prior project asset/directory before profile
activation. Global mode retains `claude-advisor.md`, `pi-implementer.md`,
`pythinker-implementer.md`, the delegate skill, and `run-isolated.sh`,
`run-opencode-isolated.sh`, `run-pi-isolated.sh`, and
`run-pythinker-isolated.sh`; it installs the canonical Codex tombstone and no
`run-codex-isolated.sh`. Pi/Pythinker notices/resolvers and tests advertise
global installation (or source-checkout development) only, never a new project
installation.

Retirement scanning is governed by a checked versioned policy, not a hand-picked
active-document list or broad documentation-directory exclusion. By default it
enumerates every regular textual blob in the exact frozen candidate tree through
hardened Git object reads; newly added root files, `CLAUDE.md`, `CONTEXT.md`,
`SUPPORT.md`, native documentation, generated assets, and future directories are
therefore included automatically. The policy enumerates only exact scanner
control-value spans, a SHA-256-bound unchanged Codex Producer adapter exception,
compatibility tombstones, one schema-aware legacy ownership-data exception, and
individual historical files that may retain a shell-route reference. No control
file is exempt as a whole: the strict policy parser permits only exact canonical
pattern/marker/path values and scans every other key/value byte; tests derive
attack strings from those parsed values instead of duplicating exempt literals.
The checked
`legacy-assets.v1.json` retains every historical wrapper path/hash/mode required
for safe cleanup; the scanner permits the retired path token only as the exact
canonical asset `path` value in that strictly parsed manifest and scans every
other string value normally. It is ownership evidence, never an active resolver
or packaging instruction. Each historical file must carry the exact marker
`<!-- claude-architect-retirement: codex-shell-references-are-historical -->`;
an unlisted file or unmarked historical file fails. Active surfaces may not link
or otherwise direct users to those retained instructions. `CHANGELOG.md` is
parsed by section: Unreleased text has no exception, while a released paragraph
may retain a non-executable reference only with the same marker. Tombstones are
active content and receive no historical-text exemption.

### Transaction

One shared profile-operation lock covers install/recovery/auth/doctor/run/review.
Its complete PID/start-token owner record is fsynced then hard-linked into
place. A live or ambiguous owner fails closed. A provably dead/PID-reused owner
may be quarantined after inode revalidation; no operation signals it.

Order:

1. Complete read-only source/project/profile/executable/discovery-root preflight
   and render all candidate bytes externally.
2. Acquire the shared external profile-operation lock.
3. Create a bounded no-follow journal recording prior current pointer, intended
   hashes, stage identity, legacy project inventory, backups, and phase.
4. Stage, fsync, and byte/mode/identity-validate the complete immutable release.
5. Atomically rename/link the complete directory to its final hash-derived path
   without changing `current.json`. An existing path is reused only on complete
   equality. This unreferenced publication is never executable through the
   stable launcher and is the only path used by process validation.
6. With transaction-private `CLAUDE_PLUGIN_DATA`, XDG data/state, HOME, temp,
   operations, locks, and synthetic auth, start the final-path gateway for a
   non-repository-taking initialize/tool-surface probe. It may not touch live
   `architect-data`, live profile auth/session state, runtime refs, worktree
   administration, or project/Git bytes.
7. Back up and remove only release-owned legacy project files; verify project
   status is now clean. On first install only, create the exact stable launcher;
   on upgrade require it to be byte/mode-identical and never replace it.
8. Still using transaction-private state, run exact final-path no-model OpenCode
   config/agent/gateway/runtime-doctor and bound checkout/snapshot checks, then
   prove project/Git bytes and the immutable config/catalog/cache closure remain
   unchanged. No Producer is started during installation.
9. Atomically replace `current.json` last as activation.
10. Mark complete, fsync, remove owned backups/stage/private probe state, and
    release the same lock. An exact newly published but unreferenced release may
    be retained for verified reuse or removed only by enumerating its manifest-
    owned closure; recovery never recursively deletes an unknown path.

Every durable manifest, journal, launcher, current pointer, and ownership
transition uses same-directory regular temp bytes, file fsync, identity
revalidation, atomic link/rename, and parent-directory fsync.

Ordinary failure restores the previous pointer and exact legacy backups. Crash
recovery validates lock/journal/inodes/hashes before completing activation or
restoring. Contradictory evidence fails closed for manual inspection. A crash
after legacy removal may temporarily leave the old route unavailable, never
partially executable.

## Data flow

### Claude Code complete flow

1. Build a canonical version-1 Delegation Spec.
2. Call Claude's `delegate` or `delegatePipeline` tool.
3. Keep the call foregrounded to a terminal result.
4. Review exact candidate/evidence.
5. Present a human decision.
6. Record accepted/rejected/revision-requested.
7. Integrate only accepted exact-hash bytes.

### OpenCode compatibility flow

1. The human authorizes a complete canonical version-1 Delegation Spec,
   including write scope, verification executable/argv/environment/network,
   timeout, and exact `producerPreferences: ["codex"]`, then supplies that JSON
   to launcher `run` with an explicit Host model.
2. Generated Build prompt may inspect the captured source, but it submits only
   a no-argument `architect_runAuthorizedPipeline` model call, which OpenCode
   maps to raw gateway tool `runAuthorizedPipeline`; the gateway consumes
   authority once and injects its private stored canonical spec into child
   `delegatePipeline`, returning only a fixed minimal classification to the
   model.
3. It keeps the call foregrounded to a terminal result.
4. After the model process exits, the launcher privately validates the pipeline's
   structured independent reviewer rounds/findings, then uses a separate
   direct MCP-client subprocess to call `reviewCandidate` only for exact
   artifact inspection/evidence, not as the independent review authority.
5. The fixed launcher validates the immutable run and review observations,
   correlates them into its separate composite envelope, and returns
   `pending-human-decision`, run id, manifest hash, pipeline findings, artifact
   evidence, and the explicit absence of OpenCode decision/integration. Model
   prose is non-authoritative.
6. It stops. No shell fallback, manual patch application, or acceptance claim.

## Failure behavior

- A running runtime returns its existing structured classifications unchanged.
- Gateway non-allowlisted calls fail before child forwarding.
- Launcher/profile/config/executable/project/doctor mismatch returns a stable
  Host `unavailable` report and starts no model or Producer.
- Dirty checkout, unsupported version, invalid profile, missing runtime,
  protocol mismatch, ineligible confinement, timeout, cancellation, and
  verification failure never invoke the shell wrapper.
- Retry requires a fresh Host-authorized attempt. Producer self-reports never
  establish candidate, decision, or integration.

## Migration and test strategy

1. Characterize current green `--lane-mode edit` shell behavior and inherited
   runtime fail-closed cases.
2. Build/test generated gateway and profile launcher/process/identity modules.
3. Build immutable external profile installation, hashing, locks, journal,
   legacy ownership inventory, and crash recovery.
4. Prove launcher doctor against malicious project/global/home/managed/account/
   auth discovery sentinels, read-symlink and nested-instruction attacks, and
   exact supported OpenCode `1.18.3`.
5. Move Host prompts and tombstone both Codex agents.
6. Run installed fake-Codex lifecycle/concurrency through the exact launcher
   profile/gateway/runtime, then retire shell source/packaging.
7. Update active docs/privacy/release surfaces and run full gates.

Required coverage includes:

- Current shell behavior is green before retirement; historical exit 65 is not
  misrepresented.
- New install and auth leave project/Git bytes/status unchanged. Doctor, review,
  and run leave the main worktree/index/HEAD/config/non-runtime refs unchanged;
  they may perform only inventoried startup recovery of runtime-owned metadata,
  and run may create runtime-owned objects, candidate refs, and temporary
  worktree administration.
- Known legacy project installs upgrade; all replaced assets are inventoried;
  unknown or user-owned files are preserved conflicts.
- Malicious project `.opencode` config/tools/plugins/agents/skills and
  AGENTS/CLAUDE/CONTEXT instructions are not loaded or executed; built-in
  read/search tools and symlink/nested-instruction attacks are denied.
- User global OpenCode/Claude/agent config, skills, plugins, credentials, and
  provider environment do not enter the profile.
- Profile `auth --provider` creates credentials only under profile data;
  unsupported providers, OAuth/well-known/metadata records, non-TTY key input,
  and active account/org config are denied; no OpenCode or refresh process
  starts.
- The exact checked model catalog is byte-bound to the release and selected
  tuple. Live/cached models.dev data, provider/model config overrides,
  unsupported SDKs/endpoints, `file://` imports, and `Npm.add` package writes are
  denied before model execution; real 1.18.3 probes leave the immutable package/
  cache closure byte-identical.
- Effective Build tools contain only `architect_runAuthorizedPipeline` and the
  three `architect_project*` tools; all built-in
  read/search/shell/edit/write/patch/task/web/
  skill/external paths are denied. The launcher MCP client exposes no model
  surface and can call only one descriptor-bound doctor or review tool.
- Gateway allowlist, bound checkout, bidirectional protocol, backpressure,
  queue/request bounds, process cleanup, and future-tool denial pass.
- Launcher/gateway SIGKILL triggers parent-death watchdog cleanup; ambiguous or
  surviving recorded descendants prevent lock reclamation.
- A second same-profile operation fails busy before OpenCode starts. Concurrent
  gateway instances from two separately installed profiles cannot exchange
  prompts, ids, progress, worktrees, logs, archives, patches, or candidates.
- Main worktree/index/HEAD/config/non-runtime refs remain unchanged and OpenCode
  cannot decide/integrate.
- Zero edit, timeout after edit, dirty checkout, stale base, invalid protocol,
  missing runtime, nested delegation, and ineligible confinement fail closed.
- Immutable hashing is non-circular and reproducible. The release gate requires
  the exact frozen Candidate Artifact `candidateTreeOid`, never inferred
  `HEAD` or live working-tree bytes, and compares that tree's packaged outputs
  with two independent clean builds. Activation and recovery never expose
  partial bytes.
- Exact OpenCode 1.18.3 no-model probes succeed against the immutable config and
  create no config metadata, dependency tree, or other file.
- Source/test TypeScript, generated runtime assets, strict Claude validation,
  exact OpenCode Host gate, installer/upgrade, lifecycle, and retirement pass.

Real provider/model and real Codex smoke tests remain opt-in. They record exact
versions/model/confinement but do not expand certification.

## Compatibility window

The migration release retains both `codex-implementer` filenames as read-only
notices. They may be removed in the next minor only after prior-release upgrade
fixtures prove no installed resolver/package path depends on them.

## Acceptance criteria

- No supported Codex edit flow invokes the retired shell wrapper or assigns
  lifecycle implementation to agent prose.
- Claude Code retains the complete existing structured lifecycle.
- The supported OpenCode entry is an external project-bound fixed launcher;
  new install/auth do not write project/Git metadata, while operations that
  start the runtime are limited to explicit unchanged-runtime Git ownership and
  recovery described above.
- Project/global discovery and mutation/process tools are disabled and verified
  before an OpenCode model starts.
- Gateway total exposure is the exact six-tool allowlist, while each descriptor
  purpose exposes only its four-tool Build or one-tool no-model subset;
  the gateway binds repository-taking calls to the installed project,
  inspection to the captured commit, and Producer selection to Codex.
- OpenCode cannot decide/integrate or manually apply a pending candidate.
- Installer/profile/gateway failure cannot fall through to shell editing.
- Legacy upgrade removes only hash-owned untracked assets and preserves unknown
  or user-owned paths.
- Immutable release activation/recovery is identity-bound, hash-checked,
  durable, and rerunnable.
- Existing runtime, protocol, Producer, platform, and certification behavior is
  unchanged.
- Profile, launcher, gateway, Host, lifecycle, upgrade, retirement, type-check,
  generated-asset, and release gates pass.

## Residual risks

This migration trusts the supported OpenCode binary/profile flag semantics and
inherits existing runtime limitations. It is not an OS sandbox around a
compromised OpenCode executable or same-user host process. Exact executable
identity/version and effective-tool checks make drift fail closed but do not
turn OpenCode into a certified Host.

OpenCode has no Controlled Integration path. A future trusted handoff requires
a separate approved design.

## References

- `src/mcp/server.ts`
- `src/mcp/tools.ts`
- `src/runtime/attempt-runtime.ts`
- `src/producers/codex-adapter.ts`
- `src/git/git-exec.ts`
- `src/git/repo-preconditions.ts`
- `runtime/bootstrap.mjs`
- `scripts/install-opencode.sh`
- OpenCode MCP configuration:
  https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/mcp-servers.mdx
- OpenCode permissions:
  https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/permissions.mdx
- OpenCode project-discovery disable behavior:
  https://github.com/anomalyco/opencode/issues/7559
- OpenCode custom tool discovery:
  https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/registry.ts
- OpenCode 1.18.3 config discovery:
  https://github.com/anomalyco/opencode/blob/v1.18.3/packages/opencode/src/config/config.ts
- OpenCode 1.18.3 config directory discovery:
  https://github.com/anomalyco/opencode/blob/v1.18.3/packages/opencode/src/config/paths.ts
- OpenCode 1.18.3 read and nested instruction behavior:
  https://github.com/anomalyco/opencode/blob/v1.18.3/packages/opencode/src/tool/read.ts
- OpenCode 1.18.3 instruction resolution:
  https://github.com/anomalyco/opencode/blob/v1.18.3/packages/opencode/src/session/instruction.ts
- OpenCode external skill disable behavior:
  https://github.com/anomalyco/opencode/issues/27526
