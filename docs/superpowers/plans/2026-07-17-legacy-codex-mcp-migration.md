# Legacy Codex MCP migration implementation plan

> **Execution note:** Implement this plan in an isolated worktree with
> `using-git-worktrees`, follow `test-driven-development` for every behavior
> change, and run `verification-before-completion` before reporting success.
> Do not commit, publish, tag, or integrate without separate human approval.

**Goal:** Retire the Codex shell edit route after Claude Code and an external,
project-bound OpenCode profile use the existing MCP runtime through tested,
fail-closed interfaces.

**Architecture:** Keep the existing runtime and protocol unchanged. Add a deep
`src/opencode-profile/` module that owns profile identity, immutable rendering,
installation/recovery, process supervision, launcher validation, Git-object
snapshot inspection, and the stdio allowlist gateway. Package two generated
Node entrypoints: a fixed profile CLI and a gateway in front of
`runtime/bootstrap.mjs`. `scripts/install-opencode.sh`
becomes a bounded router/bootstrap; it does not implement security policy in
Bash. Claude Code retains decision and integration authority. OpenCode ends at
a reviewed candidate whose status is `pending-human-decision`.

**Tech stack:** TypeScript 5.9, Node.js 22+, Vitest, esbuild, MCP JSON-RPC over
stdio, existing platform/process services, existing hardened Git runner, and
small POSIX bootstrap scripts. Initial profile Host tuples are exactly macOS
arm64 and glibc Linux x64. Every other OS/arch/libc tuple, including Windows,
must return stable unavailable before mutation.

## Fixed constraints

- Do not change `AttemptRuntime`, runtime recovery, pipeline behavior,
  verification semantics, protocol schemas, capability policy, model
  attestation, Producer certification, or confinement policy.
- Do not install a new `.opencode` directory, project ignore rule, Git config,
  index entry, hook, or other repository metadata. Operations that start the
  unchanged runtime may perform only its inventoried startup recovery; `run`
  may additionally create runtime-owned Git objects, candidate refs, and
  temporary worktree administration. Main worktree bytes/index/HEAD/config and
  non-runtime refs remain unchanged.
- Do not add an OpenCode decision, integration, manual patch application, or
  cross-Host handoff path.
- Do not treat OpenCode config permissions as the sole authority boundary. The
  fixed launcher, isolated environment, effective-agent check, and MCP gateway
  are independent gates.
- Do not pass command strings to a shell. Resolve executables and pass argv
  arrays through existing platform services.
- Do not recursively delete project or profile paths. Every destructive action
  requires a checked regular-file/directory identity and exact ownership hash.
- Do not silently broaden the OpenCode compatibility range. The initial exact
  supported version is `1.18.3`.
- Do not remove the legacy shell route until its replacement lifecycle,
  upgrade, retirement, and generated-asset gates all pass.

## Stable public behavior

The installed launcher accepts only:

```text
launcher.mjs auth --provider <id>
launcher.mjs doctor
launcher.mjs run --model <provider/model> [--variant <value>]
launcher.mjs review --run-id <id>
```

`run` reads a bounded, human-authorized canonical version-1 Delegation Spec JSON
from stdin. No operation accepts an arbitrary cwd, agent, config, permission,
plugin, command, attach/server, sharing, `--auto`, or raw OpenCode argument.

The gateway exposes exactly six raw wire tools:

```text
runAuthorizedPipeline
reviewCandidate
doctor
projectRead
projectList
projectSearch
```

The immutable OpenCode MCP server key is `architect`, so the exact model-facing
Build tools are `architect_runAuthorizedPipeline`, `architect_projectRead`,
`architect_projectList`, and `architect_projectSearch`. Raw `doctor` and
`reviewCandidate` are launcher-client-only and never become OpenCode tools.

`doctor` and `reviewCandidate` are filtered runtime calls.
`runAuthorizedPipeline` is a no-argument gateway-local proxy that atomically
consumes one descriptor authority and injects the private stored spec into child
`delegatePipeline`; the runtime schema/spec and full child result never enter
the model surface. Its model-facing result is a fixed minimal terminal
classification. The private run observation receives only a strict closed
pipeline projection; no full child result, patch, raw evidence, or command
output is stored there. The
last three tools inspect only captured clean `HEAD` through hardened Git object
commands and accept no repository/revision argument. The runtime's live-worktree
Git read tools are not exposed. The Build model receives only the four
namespaced tools above. A launcher-owned bounded
MCP client, not an OpenCode agent, invokes only purpose-bound `doctor` or
`reviewCandidate`. OpenCode built-in `read`, `glob`, `grep`, and every
mutation/process tool are denied. The
launcher, not model prose, validates separate immutable run and review
observations and emits their bounded correlated composite: run id, candidate
manifest hash, structured pipeline reviewer findings, literal status
`pending-human-decision`, and confirmation that no decision or integration was
performed.

## Implementation file map

### Add

- `src/opencode-profile/contracts.ts`: versioned records, limits, allowlists,
  parsers, and stable unavailable classifications.
- `src/opencode-profile/fs-policy.ts`: no-follow identity, containment,
  canonical JSON/hash, durable atomic file, and directory policy.
- `src/opencode-profile/locks.ts`: hard-link lock acquisition, owner liveness,
  quarantine, release, and stale-owner policy.
- `src/opencode-profile/process.ts`: bounded executable probes and supervised
  child processes for launcher and gateway use.
- `src/opencode-profile/parent-watchdog.ts`: exact parent PID/start-token death
  detection and complete child-group teardown.
- `src/opencode-profile/legacy-inventory.ts`: checked legacy ownership inventory
  parser and exact cleanup classification.
- `src/opencode-profile/snapshot-tools.ts`: bounded, no-symlink inspection of a
  launcher-captured Git commit without working-tree reads.
- `src/opencode-profile/gateway.ts`: bidirectional bounded JSON-RPC filter and
  child lifecycle.
- `src/opencode-profile/mcp-client.ts`: launcher-owned bounded stdio client for
  one purpose-bound doctor or artifact-inspection call.
- `src/opencode-profile/profile-manager.ts`: project binding, render, immutable
  release hashing, install/upgrade transaction, and recovery.
- `src/opencode-profile/doctor.ts`: immutable/effective-profile checks with no
  model invocation.
- `src/opencode-profile/launcher.ts`: fixed `auth`, `doctor`, `run`, and `review`
  command implementation.
- `src/opencode-profile/gateway-entry.ts`: generated gateway entrypoint.
- `src/opencode-profile/watchdog-entry.ts`: generated parent-death watchdog
  entrypoint.
- `src/opencode-profile/cli-entry.ts`: generated installer/launcher entrypoint.
- `profiles/opencode/compatibility.v1.json`: exact platform, Node, OpenCode,
  environment, immutable config, and discovery-root policy.
- `profiles/opencode/models.v1.json`: canonical models.dev-compatible subset for
  the exact supported providers/models/variants, SDKs, and endpoints.
- `profiles/opencode/retirement-policy.v1.json`: universal frozen-tree text scan
  with exact control, Producer-adapter, tombstone, historical-record, marker,
  schema-aware ownership-data, changelog, and inbound-link policy.
- `profiles/opencode/legacy-assets.v1.json`: release-owned path/hash/mode
  inventory for supported project installs.
- `profiles/opencode/legacy-source-tags.v1.json`: immutable tag-to-peeled-commit
  OID allowlist from `v0.5.0` through the immediate pre-migration release.
- `profiles/opencode/host-gate/package.json` and `package-lock.json`: exact
  `opencode-ai@1.18.3` CI Host-gate dependency and full npm integrity closure.
- `tsconfig.tests.json`: strict type-check boundary for new TypeScript tests.
- `profiles/opencode/BUILD_PROMPT.md`: pending-only OpenCode compatibility Host
  instructions.
- `profiles/opencode/RUN_MESSAGE.txt`: exact non-secret literal OpenCode run
  message; authorized spec bytes never replace it or enter child stdin.
- `profiles/opencode/CODEX_AGENT_TOMBSTONE.md`: canonical read-only global/
  source OpenCode Codex migration notice available before global migration.
- `scripts/generate-opencode-legacy-inventory.mjs`: maintainer-only inventory
  generator from supported release tags.
- `scripts/resolve-opencode-host-gate.mjs`: checked OS/arch/libc selector for the
  integrity-pinned platform package binary without lifecycle scripts.
- `scripts/verify-generated-reproducibility.mjs`: require one explicit frozen
  Candidate Artifact tree OID, build it in two independent absolute roots, and
  compare both builds with the generated bytes stored in that tree.
- `tests/opencode-profile/contracts.test.ts`
- `tests/opencode-profile/model-catalog.test.ts`
- `tests/opencode-profile/fs-policy.test.ts`
- `tests/opencode-profile/locks.test.ts`
- `tests/opencode-profile/process.test.ts`
- `tests/opencode-profile/legacy-inventory.test.ts`
- `tests/opencode-profile/snapshot-tools.test.ts`
- `tests/opencode-profile/gateway.test.ts`
- `tests/opencode-profile/profile-manager.test.ts`
- `tests/opencode-profile/doctor.test.ts`
- `tests/opencode-profile/launcher.test.ts`
- `tests/opencode-profile/host-contract.test.ts`
- `tests/opencode-profile/lifecycle.test.ts`
- `tests/opencode-profile/retirement.test.ts`

### Modify

- `esbuild.config.mjs`: reproducibly generate the server, profile CLI, and
  gateway bundles.
- `package.json`: add generated-asset and narrow profile test commands only if
  they remove repeated command text; add required `typecheck:tests`.
- `vitest.config.ts`: collect the new `tests/opencode-profile/**/*.test.ts`
  suites in addition to existing `tests/runtime/` suites; continue excluding
  legacy root `*.test.mjs` node:test files.
- `scripts/install-opencode.sh`: route `--project` to the generated profile CLI;
  retain the separately scoped global Pi/Pythinker installation behavior.
- `scripts/validate-release.sh`: require profile manifests, regenerated bytes,
  exact compatibility, upgrade, Host, lifecycle, and retirement gates.
- `.github/workflows/ci.yml`: fetch required ownership tags and provision the
  exact integrity-pinned OpenCode Host gate on macOS-arm64/glibc-Linux-x64,
  selecting the baseline Linux binary.
- `.opencode/agents/codex-implementer.md`: replace executable instructions with
  a read-only external-profile migration notice.
- `.opencode/agents/pi-implementer.md` and
  `.opencode/agents/pythinker-implementer.md`: remove claims/resolution paths for
  a newly installed project-local surface; retain global and source-checkout
  behavior.
- `agents/codex-implementer.md`: replace executable instructions with a
  read-only Claude MCP migration notice.
- `skills/delegate/SKILL.md`: remove shell fallback and distinguish Claude's
  complete lifecycle from OpenCode's pending-only compatibility lifecycle.
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
  `src/protocol/versions.ts`, and
  version-pinned assertions in `tests/runtime/plugin-wiring.test.mjs`: keep
  release version surfaces synchronized when the human selects the release.
- `README.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`,
  `docs/operations.md`, `docs/PLUGIN_COMPONENTS.md`, `docs/PRIVACY.md`,
  `docs/SECURITY_MODEL.md`, `docs/THREAT_MODEL.md`,
  `docs/TRUST_BOUNDARIES.md`, and `docs/MARKETPLACE_REVIEW.md`: document profile
  location, credential/retention boundaries, supported commands/version/
  platforms, cleanup, trust limits, and retirement.
- `tests/codex-lifecycle.test.sh`: preserve characterization until retirement,
  then replace shell assertions with tombstone/no-fallback assertions.
- `tests/lane-contract.test.mjs`: remove Codex edit-lane expectations only after
  replacement lifecycle tests pass; keep unrelated lane coverage.
- `tests/runtime/isolated-scripts.test.ts`: remove retired Codex script cases
  only after profile process/isolation tests cover the same failure classes.
- `tests/install-opencode.test.sh`: migrate project-install and global-resolver
  assertions without weakening Pi/Pythinker coverage.
- `tests/delegate-routing.test.mjs`: replace executable Codex-agent routing with
  Claude MCP and external-profile tombstone assertions.
- `tests/lane-model-fallback.test.mjs`: remove Codex shell-model assertions while
  preserving unrelated lane fallback coverage.
- `tests/claude-runtime-resolver.test.sh`: remove only the retired Codex shell
  resolver cases.
- `tests/validate-release.test.sh`: cover required tag history, pinned tag OID
  drift, OpenCode artifact integrity/provisioning, and new generated gates.
- `tests/runtime/plugin-wiring.test.mjs`: retain no-fallback and Claude MCP
  wiring assertions against the new tombstones.

### Generate

- `runtime/opencode-profile-cli.mjs`
- `runtime/opencode-mcp-gateway.mjs`
- `runtime/opencode-profile-watchdog.mjs`
- Existing `runtime/server.mjs` remains reproducibly generated.

### Delete last

- `scripts/run-codex-isolated.sh`

Do not delete either `codex-implementer.md` filename in this release. Both are
compatibility tombstones for one minor-version window.

## Task 1: Freeze current shell characterization

**Files:**

- Verify: `tests/codex-lifecycle.test.sh`
- Verify: `tests/lane-contract.test.mjs`
- Verify: `tests/runtime/isolated-scripts.test.ts`
- Modify only if missing: the same test files

1. Run the current characterization before production edits:

   ```bash
   bash tests/codex-lifecycle.test.sh
   node tests/lane-contract.test.mjs
   npx vitest run tests/runtime/isolated-scripts.test.ts
   ```

2. Confirm the tests assert the current `--lane-mode edit` contract, hidden
   option rejection, cleanup, timeout, and nested-delegation behavior. Do not
   add a RED test for the historical raw `--sandbox`/`--cd` exit-65 command.

3. If a characterization is absent, add the smallest assertion against current
   green behavior and rerun the exact command. Do not change implementation in
   this task.

4. Record the passing commands in the eventual change summary. Their purpose is
   deletion safety, not evidence that the replacement already works.

## Task 2: Define profile contracts and fail-closed parsers

**Files:**

- Create: `src/opencode-profile/contracts.ts`
- Create: `profiles/opencode/compatibility.v1.json`
- Create: `profiles/opencode/models.v1.json`
- Create: `profiles/opencode/retirement-policy.v1.json`
- Create: `profiles/opencode/host-gate/package.json`
- Create: `profiles/opencode/host-gate/package-lock.json`
- Create: `tests/opencode-profile/contracts.test.ts`
- Create: `tests/opencode-profile/model-catalog.test.ts`
- Create: `tsconfig.tests.json`
- Modify: `package.json`
- Modify: `vitest.config.ts`

1. Extend `vitest.config.ts` with the exact new TypeScript test directory and
   update its explanatory comment. Keep root node:test files excluded. Then
   write failing table tests for:

   Add `tsconfig.tests.json` extending production compiler options but
   explicitly setting `rootDir: "."`, `noEmit: true`, and required Node/Vitest
   types, and including `tests/opencode-profile/**/*.ts`. Add
   `npm run typecheck:tests` as `tsc -p tsconfig.tests.json --noEmit`; do not
   weaken strictness or exclude failing fixtures from type-check.

   - Exact profile/manifest/journal/inventory format versions.
   - Exact OpenCode version `1.18.3`, npm package `opencode-ai@1.18.3`
     integrity
     `sha512-HnItl/+uhSpj7JV9x6ITiE0XFq4b/PKF5OM03TIyiFoFiLw3MQoJOAXZFTEzC7IOgAIYcysRQBBmCmlXILkxww==`,
     and Node major `>=22`.
   - Host-gate package/lock declaring only exact `opencode-ai@1.18.3`, with the
      top-level and all platform-optional package integrities pinned and no
      lifecycle script execution in the provisioning contract.
   - A provision record binding selected direct package name/version/SRI,
     extracted binary SHA-256/mode, and copied release-binary SHA-256. The
     extracted digest is trusted only after lock/SRI validation and must match
     the copied/final bytes; a user-global executable is never an input.
   - Exact macOS-arm64/`opencode-darwin-arm64` and glibc-Linux-x64/
     `opencode-linux-x64-baseline` support. Always select the baseline package
     on supported Linux x64 so AVX2 is not an undeclared prerequisite; never
     select `opencode-linux-x64`. Pin the selected baseline package integrity to
     `sha512-DDfspGSQ123yhsFhAlbpF+tsvje5kHOS2/PYUpWJroTlvgtqRLGmET51Anrxd5BrAFrqB6PXYA2kGh5QStPU/g==`.
     Return deterministic unavailable for macOS x64, Linux arm64/musl, Windows,
     and unknown tuples.
   - Exact supported provider ids `anthropic`, `openai`, `opencode`, and
     `openrouter`; exact bundled SDK keys `@ai-sdk/anthropic`,
     `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, and
     `@openrouter/ai-sdk-provider`; and a canonical catalog hash. Every model,
     optional variant, effective SDK key, and HTTPS endpoint origin must be an
     exact tuple in `models.v1.json`. Reject package versions/ranges/aliases,
     URL/path/Git/workspace specs, `file://`, unknown providers, and duplicate or
     shadowed model ids.
   - Exact Codex/Node/Git resolved-executable records, canonical `CODEX_HOME`
     directory and `auth.json` identities without secret hashes, and per-run
     resolved verification-executable records. PATH entries are derived from
     those records only and command-name collisions/resolution drift are closed
     classifications.
   - Effective uid 0 failing as `unsupported-identity` before mutation.
   - Exact launcher command grammar and rejection of unknown/repeated/options
     with missing values.
   - Bounded canonical authorized spec, run id, model, variant, JSON line,
     stderr, queue, pending request, manifest, journal, and executable-probe
     sizes.
   - Fixed ten-minute auth/doctor/review Host deadlines, fixed six-hour run Host
     deadline, and conservative pipeline worst-case estimation from authorized
     timeout/verification/review/retry cardinality.
   - Exact six-tool total allowlist, exact two directly forwarded runtime names,
     one no-argument authorized-pipeline proxy, three gateway-local snapshot
     names, immutable MCP server key `architect`, exact four namespaced Build
     names, one-tool raw doctor/review subsets, and exact repository-taking
     subset.
   - Exact MCP wire protocol `2025-11-25` on both gateway and launcher-client
     initialize exchanges; no SDK fallback version is accepted.
   - Exact application `PROTOCOL_VERSION` imported from
     `src/protocol/versions.ts` and bound into the release/descriptor. Tests keep
     it distinct from the MCP wire version and fail on stale hard-coded values.
   - Unknown object keys, invalid paths, control characters, malformed hashes,
     and unsupported record versions failing closed.
   - Stable redacted classifications such as `unsupported-platform`,
     `unsupported-opencode`, `invalid-profile`, `identity-mismatch`,
     `dirty-checkout`, `gateway-unavailable`, and `recovery-required`.
   - Three disjoint strict records: run observation with the Task 6 pipeline
     projection, review observation with only requested run id/correlation/
     changed-path/hash projection, and launcher composite with exact cross-record
     identity/digest correlation. None accepts passthrough payloads, unknown
     keys, raw output/evidence, or accepted/integrated status; only the composite
     can encode `pending-human-decision`.
   - Strict one-shot subprocess descriptors binding profile/release/project
     hashes, operation/purpose, optional captured OID, canonical authorized-spec
     file/hash, observation identity, random nonce, expiry, and operation-lock
     identity; unknown/reused keys fail closed.
   - A strict retirement-policy record with no globs or unknown keys. Its exact
     tombstones, scanner control-value spans, SHA-256-bound Producer-adapter
     exception, schema-aware ownership-data field exception, historical files,
     marker, changelog rule, forbidden semantic classes, deterministic text
     classification, frozen-tree binding, and no-inbound-link rule are non-empty,
     unique, canonical repository-relative paths with no overlap between
     exception classes. Everything not excepted is scanned.

2. Run the test and confirm the missing module/contracts are RED:

   ```bash
    npx vitest run tests/opencode-profile/contracts.test.ts tests/opencode-profile/model-catalog.test.ts
   ```

3. Implement constants, discriminated TypeScript types, and strict parsers. Use
   one canonical error envelope:

   ```ts
   interface ProfileUnavailable {
     status: "unavailable";
     classification: ProfileUnavailableClassification;
     message: string;
   }
   ```

   Keep diagnostics actionable but never include prompts, credentials, provider
   environment, arbitrary argv, or unbounded child output.

4. Make `compatibility.v1.json` the checked data source for exact versions,
   supported platforms, required disable flags, co-located immutable
   XDG/config-root invariant, forbidden managed/account/auth states, pinned npm
   integrity, and all byte/count limits. Parse it strictly at startup.

   Make `models.v1.json` manually seeded, human-reviewed immutable input in the
   exact models.dev schema; it is not generated from the official binary or a
   live endpoint. Record provenance models.dev commit
   `1eb0b8c8e17ffddd89f53b2a3e426777dc560542`, canonical-byte SHA-256, four
   provider ids, and every model/variant/npm/endpoint tuple in
   `compatibility.v1.json`. Runtime authority is the checked local file/hash,
   not provenance. Tests reject unknown schema fields, empty providers,
   duplicate/shadowed ids, unsupported npm/endpoint values, and non-canonical
   bytes. Updating its contents is a separate human-reviewed compatibility
   change, never automatic release generation.

   At the real Host gate, set `OPENCODE_MODELS_PATH` to this checked file and
   create a transaction-private synthetic `{type:"api",key}` record for one
   provider at a time. Invoke only bounded `opencode models <provider> --verbose`
   without `--refresh`, compare its provider/model/variant/npm/endpoint
   projection to that provider's static subset, then destroy the private state.
   Any network attempt, package/cache write, plugin discovery, malformed output,
   projection mismatch, or missing provider fails. Production `doctor` validates
   static bytes/hash/config only; production `run` performs the same projection
   check only for its selected already-authenticated provider.

   Make `retirement-policy.v1.json` the checked source for the retirement scan.
   The scanner takes one mandatory frozen candidate tree OID, enumerates every
   blob with hardened `git ls-tree -rz --full-tree`, rejects replacement/graft/
   lazy-fetch ambiguity, and applies a deterministic bounded UTF-8/text rule to
   every regular blob. It has no live filesystem, `HEAD`, root-path, extension,
   or newly-added-directory allowlist. Consequently root guidance including
   `CLAUDE.md`, `CONTEXT.md`, `SUPPORT.md`, `scratchpad.md`, native docs, all
   other docs, generated runtime, and future tracked text are scanned by
   default. There is no scanner-control-file exemption. Strictly parse
   `retirement-policy.v1.json`, permit only the exact byte spans of canonical
   forbidden-pattern/marker/approved-path values, and scan every other JSON
   key/value byte. `retirement.test.ts` and scanner code load those values and
   derive fixtures dynamically, so they contain no duplicate exempt literal.
   Reject added control values, surrounding command text, duplicate keys,
   reordered non-canonical bytes, or a token outside its approved span.

   Raw Codex Producer invocation is permitted only when
   `src/producers/codex-adapter.ts` has SHA-256
   `08262beb6bcf4b3698b896b0f14b03023f447750a92a8da35d97508751c78b99`.
   Any adapter change requires explicit re-review and policy update; even at the
   matching hash, the exception does not permit the retired wrapper, OpenCode
   routing, fallback, decision, or integration language.

   `profiles/opencode/legacy-assets.v1.json` is the sole structured historical-
   data exception. Parse it with the strict canonical inventory parser before
   scanning; permit `scripts/run-codex-isolated.sh` only as an exact
   `/releases/*/assets/*/path` value accompanied by the required pinned tag OID,
   blob hash, and executable mode. Scan every other key/string normally. Reject
   duplicate keys/paths, alternate spellings, embedded commands, extra fields,
   malformed JSON, or the token in any other JSON pointer. Tests derive the
   expected wrapper path from the parsed inventory rather than copying an exempt
   literal into another source file.

   The exact historical-reference list is:

   ```text
   docs/superpowers/plans/2026-07-13-codex-runner-stdin-forwarding.md
   docs/superpowers/plans/2026-07-13-lane-architecture-enhancements.md
   docs/superpowers/plans/2026-07-14-bounded-delegation-attempt.md
   docs/superpowers/plans/2026-07-14-disable-codex-multi-agent.md
   docs/superpowers/plans/2026-07-14-p0-runtime-implementation.md
   docs/superpowers/plans/2026-07-15-p0c-producer-completion.md
   docs/superpowers/plans/2026-07-16-orphan-cleanup-and-spec-tightening.md
   docs/superpowers/plans/2026-07-17-delegation-contract-repair.md
   docs/superpowers/plans/2026-07-17-legacy-codex-mcp-migration.md
   docs/superpowers/specs/2026-07-14-disable-codex-multi-agent-design.md
   docs/superpowers/specs/2026-07-17-delegation-contract-repair-design.md
   docs/superpowers/specs/2026-07-17-legacy-codex-mcp-migration-design.md
   ```

   Each listed file must contain, within its first 20 lines, exactly
   `<!-- claude-architect-retirement: codex-shell-references-are-historical -->`.
   No other plan/spec path is exempt merely because it is under
   `docs/superpowers/`. The exact tombstones are
   `.opencode/agents/codex-implementer.md`, `agents/codex-implementer.md`, and
   `profiles/opencode/CODEX_AGENT_TOMBSTONE.md`; they remain active-scanned and
   receive no historical-reference exemption.

   Before marking
   `docs/superpowers/plans/2026-07-15-p0c-producer-completion.md`, replace its
   literal C0/DEL bytes in the documented regex with visible escaped forms
   `\u0000-\u001f\u007f`; preserve the example's meaning. Require valid UTF-8
   and reject NUL, C0 other than tab/LF/CR, and DEL in every Markdown, source,
   script, JSON/YAML, manifest, extensionless configuration, or other path the
   policy classifies as textual. First scan forbidden ASCII byte sequences in
   every blob before binary/text classification, so an extension or invalid
   encoding cannot hide a retired route.

5. Rerun the narrow test and type-check:

   ```bash
    npx vitest run tests/opencode-profile/contracts.test.ts tests/opencode-profile/model-catalog.test.ts
   npx tsc --noEmit
   npm run typecheck:tests
   ```

## Task 3: Implement no-follow identity and durable filesystem policy

**Files:**

- Create: `src/opencode-profile/fs-policy.ts`
- Create: `tests/opencode-profile/fs-policy.test.ts`

1. Write failing tests for:

   - Canonical worktree and Git common-directory tuples producing a stable
     versioned SHA-256 project key.
   - Recorded no-follow identities/link counts detecting a replaced root or a
     multiply linked protected regular file at the same path; directory link
     counts are recorded but are not mistaken for file hard links.
   - Canonical Git common directory, per-worktree Git directory, and `.git`
     directory/gitfile binding detecting changed indirection.
   - Symlinked ancestors, leaves, hard-linked protected regular files, special
     files, owner/mode drift, and repository/profile escapes being rejected.
   - Canonical JSON sorting and byte-identical hashes across runs.
   - Same-directory temp creation with restrictive mode, file fsync, atomic
     rename/link, parent fsync, and identity revalidation.
   - Existing destination reuse only when byte hash, mode, identity, and owning
     manifest all match.
   - New-install helpers leaving every project and Git byte unchanged.

2. Run the test and confirm RED:

   ```bash
   npx vitest run tests/opencode-profile/fs-policy.test.ts
   ```

3. Implement a small no-follow API rather than ad hoc `stat`/`realpath` calls in
   later modules. It must return typed identities containing canonical path,
   device/inode where supported, type, mode, uid where supported, and size.

4. Implement canonical serialization and SHA-256 helpers with domain/version
   prefixes. Never hash JSON produced from insertion-order-dependent objects.

5. Implement durable atomic regular-file creation/replacement and checked empty
   directory removal. Do not expose a recursive delete helper.

6. Rerun:

   ```bash
   npx vitest run tests/opencode-profile/fs-policy.test.ts
   npx tsc --noEmit
   ```

## Task 4: Reuse hardened Git and build the legacy ownership inventory

**Files:**

- Modify only if needed: `src/git/git-exec.ts`
- Create: `src/opencode-profile/legacy-inventory.ts`
- Create: `profiles/opencode/legacy-assets.v1.json`
- Create: `profiles/opencode/legacy-source-tags.v1.json`
- Create: `scripts/generate-opencode-legacy-inventory.mjs`
- Create: `tests/opencode-profile/legacy-inventory.test.ts`
- Modify: `scripts/validate-release.sh`

1. Write failing tests proving project inspection uses the existing `git()`
   executable-plus-argv path and neutralizes inherited `GIT_*`, global/system
   config, hooks, fsmonitor, attributes, external diff/textconv, and filters.
   Add no second, weaker Git runner.

2. Write failing inventory tests for every project-installer tag from `v0.5.0`
   through `v0.19.0`, including patch tags. Cover every destination installed
   by each tag's project mode. For each tag, pin its peeled commit OID; for each
   path, record exact content hash, executable/non-executable mode, and owned
   empty parent directories. Tags before `v0.5.0` are outside cleanup because
   no project installer existed; never infer their ownership.

   Apply the same tag/path/hash/mode records relative to prior global
   destination roots. Add fixtures for an exact owned global Codex
   agent/wrapper and modified or user-owned conflicts.

   Manually seed and human-review a separate canonical, non-generated
   `legacy-source-tags.v1.json` using this current tag-to-peeled-OID authority:

   ```text
   v0.5.0  c761de3066c78c142332585479c2ae8c9f4fda08
   v0.6.0  8e9d15e8bdd1e4e0f0a1e4718e60392a36a82e3b
   v0.7.0  a2ba48be196d5c32a43a446523f56a4ec7ec0bad
   v0.8.0  3b0d6549c9cff5e064dda7b2d61fec3985e0aae6
   v0.9.0  c74768c690db2f2e54f9321e0c3809730623c379
   v0.9.1  67f112e1a6d7fdd554a73f9b30087f08a9f8087c
   v0.9.2  ac6315fca280244f7bdfb5a3a3b5177e3ba5bf58
   v0.9.3  5a667f3a7ceb7ef5a9f37d8909e867bd1e2a5e6d
   v0.10.0 97ca57b09d790e97b1338af20fead77169aa0554
   v0.11.0 d0560d1479d224e24d9f5c30e3efbe8b0f2e1f1c
   v0.11.1 03b8cd5f468711d543afbf24bc0a86c9b714a670
   v0.12.0 f67b2376dff70a0d03b2b8a7828e5b41c1c16a1f
   v0.12.1 2ef5e084f697fa179c87e68ffbfe08e3f6a4016d
   v0.13.0 a387c040e901f574de9fca6a2f04ae996b90eaae
   v0.14.0 8f49d3c04fc3983507fbb12c154a2e9ead291bfb
   v0.15.0 ebf1a3b8adf7cb430ee3266fbcfe189d2b15f6ca
   v0.16.0 5ab8b4ff390e0ee66c37a5d4cf60d6bc83b4017f
   v0.17.0 dde252a826f7593e2cb9934630869f219c191f52
   v0.18.0 7ae784131f9cb34bd5b5f070e2e9be19353f0ccf
   v0.19.0 ed0af12421d19f76ce7157904a3b2dfd1adbe237
   ```

   The generator treats this file as immutable input and never writes it. The
   asset inventory records those OIDs but never derives trust from a movable
   tag during release validation. If a release is published
   after `v0.19.0` before this migration ships, extend the checked endpoint to
   the immediate predecessor before implementation begins.

3. Add adversarial classification tests:

   - Exact untracked path/hash/mode is removable.
   - Tracked, ignored-user-owned, modified, unknown, symlinked, hard-linked,
     special, missing-parent, and identity-raced paths are preserved conflicts.
   - An unrelated dirty path blocks activation.
   - Cleanup returns an explicit itemized plan before mutating anything.
   - Moved tag refs, loose/packed replacement refs, legacy grafts, inherited
     replace-ref base, and replacement objects cannot alter generated ownership
     bytes; generator pre/post checks fail closed.

4. Run and confirm RED:

   ```bash
   npx vitest run tests/opencode-profile/legacy-inventory.test.ts
   ```

5. Implement the strict inventory parser and classifier. The production module
   consumes checked JSON; it never runs `git show` at install time.

6. Implement the maintainer generator using only
   `git show <allowlisted-peeled-oid>:<path>` through executable-plus-argv with
   bounded output, `GIT_NO_REPLACE_OBJECTS=1`, and no lazy fetch. Before and
   after all reads, reject `refs/replace/*` and `.git/info/grafts`, and require
   each fetched tag to peel to its independently checked OID. A mismatch aborts
   before reading asset bytes. Require deterministic ordering and a clean asset-
   manifest diff; never generate or rewrite the OID authority file.

7. Add a release-validation step that regenerates from the required tags and
   fails on drift. If release validation runs in a tagless source archive, fail
   with an actionable prerequisite rather than trusting stale ownership data.

8. Rerun the narrow test and inventory generation twice, asserting the second
   run has no diff:

   ```bash
   FIRST_INVENTORY=$(mktemp)
   node scripts/generate-opencode-legacy-inventory.mjs
   cp profiles/opencode/legacy-assets.v1.json "$FIRST_INVENTORY"
   node scripts/generate-opencode-legacy-inventory.mjs
   cmp -s "$FIRST_INVENTORY" profiles/opencode/legacy-assets.v1.json
   npx vitest run tests/opencode-profile/legacy-inventory.test.ts
   git ls-files --error-unmatch profiles/opencode/legacy-assets.v1.json profiles/opencode/legacy-source-tags.v1.json
   git diff --exit-code -- profiles/opencode/legacy-assets.v1.json profiles/opencode/legacy-source-tags.v1.json
   ```

## Task 5: Add locks and bounded process supervision

**Files:**

- Create: `src/opencode-profile/locks.ts`
- Create: `src/opencode-profile/process.ts`
- Create: `src/opencode-profile/parent-watchdog.ts`
- Create: `src/opencode-profile/watchdog-entry.ts`
- Create: `tests/opencode-profile/locks.test.ts`
- Create: `tests/opencode-profile/process.test.ts`

1. Write failing lock tests for:

   - A complete owner record being fsynced before atomic hard-link acquisition.
   - One winner under concurrent acquisition.
   - Live owner, ambiguous liveness, PID reuse, dead owner, inode race, corrupt
     owner, symlink, and special-file behavior.
   - Dead-owner quarantine only after process start-token and inode
     revalidation; the installer never signals a stale owner.
   - Release removing only the exact lock inode owned by the caller.

2. Write failing process tests for:

   - Executable resolution and identity/version probes with argv arrays. Profile
     operations accept only the manifest-bound release-local OpenCode binary;
     PATH/global npm shims and caller executable overrides are ignored/rejected.
   - Install-time existing-platform-service resolution of Codex, Node, and Git;
     no-follow command/prefix executable identity/hash/version records; current
     Codex edit eligibility; and exact revalidation before each operation.
   - Canonical `CODEX_HOME` precedence (non-empty inherited value, otherwise real
     host home `/.codex`), same-user non-public directory, singly linked regular
     `auth.json`, no credential reads/hashes/logs, and missing/symlinked/public/
     changed/unauthenticated rejection before profile mutation.
   - Per-run pre-resolution of every human-authorized verification executable
     and an ordered PATH containing only parent directories required by recorded
     Codex/Node/Git/verification commands. Duplicate basename ambiguity,
     replacement races, inherited extra entries, and runtime resolution or
     capability-report mismatch fail before Producer/verification execution.
   - Exact OpenCode `1.18.3`, Node 22+, bounded stdout/stderr, timeout,
     cancellation, process-tree escalation, early error, and no orphan.
   - Environment construction from an allowlist rather than `process.env`
     spread.
   - Removal of OpenCode overrides, provider secrets, delegation markers, user
     config/plugin/skill paths, shell startup variables, and unrelated
     credential variables.
    - `auth --provider` starts no child process and reads a bounded key only from
      an echo-disabled controlling TTY; redirected stdin, argv/environment key
      material, browser/OAuth/network behavior, and non-restored TTY state fail.
      Model `run` receives the smaller fixed environment with no key variable.
    - `OPENCODE_CONFIG_DIR` exactly equals the path OpenCode derives as
      `$XDG_CONFIG_HOME/opencode`, both point inside the current read-only release,
      and isolated `$HOME/.opencode` is absent.
    - `OPENCODE_MODELS_PATH` equals the hash-verified release
      `models.v1.json`; `OPENCODE_DISABLE_MODELS_FETCH=1`; `XDG_CACHE_HOME`
      points to the release's read-only cache; its precreated `opencode/bin` and
      empty `opencode/packages` directories are mode `0555`; and `NODE_PATH`,
      Node import hooks, npm/Bun config/install/cache overrides, package-manager
      credentials, and model URL/path overrides are absent.
   - Well-known auth, active account/org data, `/etc/opencode` or
     `/Library/Application Support/opencode` config, macOS managed preferences,
     and inherited account/config override state fail before OpenCode starts.
   - A profile-only whole-operation supervisor supports the fixed six-hour run
     bound without passing an invalid duration to the existing 30-minute
     `supervise`; ten-minute short operations may reuse it.
   - Worst-case estimator drift tests bind current schema maxima, reviewer/
     round counts, and role retry constants. An estimated-over-bound spec fails
     before OpenCode/baseline/Producer; deadline kills the complete watched tree.
   - Watchdog startup fsyncing watchdog/child PID, start token, and process-group
     identity before readiness; exact parent death/PID reuse detection; launcher
     or gateway SIGKILL; cooperative termination then escalation; and no orphan.
   - Watchdog death or ambiguous surviving child prevents operation-lock
     reclamation; a later operation never signals the recorded process.

3. Run and confirm RED:

   ```bash
   npx vitest run tests/opencode-profile/locks.test.ts tests/opencode-profile/process.test.ts
   ```

4. Implement the lock protocol using `fs.link`, no-follow identities, bounded
   canonical owner records, PID/start-token liveness, and directory fsync.

5. Implement process helpers and the watchdog by composing existing
   `PlatformServices`, process start-token/liveness primitives, and `supervise`
   for short operations. Implement a profile-only whole-operation supervisor
   for the six-hour run; do not weaken/change runtime `supervise` or its ceiling.
   Do not add shell interpolation. Launcher starts OpenCode through the packaged
   watchdog; gateway starts `runtime/bootstrap.mjs` through another instance.
   Readiness is impossible until child identities are durable.

6. Rerun the narrow tests and type-check.

## Task 6: Build snapshot inspection and the stdio allowlist gateway

**Files:**

- Create: `src/opencode-profile/snapshot-tools.ts`
- Create: `src/opencode-profile/gateway.ts`
- Create: `src/opencode-profile/gateway-entry.ts`
- Create: `tests/opencode-profile/snapshot-tools.test.ts`
- Create: `tests/opencode-profile/gateway.test.ts`

1. Write failing snapshot-tool tests against a repository containing regular
   files, executable files, subdirectories, unusual valid Git paths, a symlink
   entry, large blobs, binary blobs, and a later working-tree/HEAD change.
   Require:

   - `projectRead` validates one repository-relative path, resolves its entry
     from the captured commit with `git ls-tree`, rejects mode `120000`, and
     reads the selected blob OID with bounded `git cat-file` output.
   - `projectList` lists bounded paths from the captured tree with an optional
     validated literal prefix and deterministic pagination; it never follows a
     worktree path.
   - `projectSearch` performs a bounded literal-content search over regular
     blobs from the captured tree, with optional validated path prefix and case
     mode. It accepts no regular expression or executable search command.
   - No tool accepts a repository path, revision, object id, absolute path,
     traversal, NUL/control character, symlink entry, special tree mode, or
     unbounded output request.
   - A changed working tree, moved `HEAD`, symlink target, or external file
     after capture cannot change results from the captured commit.
   - Loose/packed `refs/replace/*`, a legacy `.git/info/grafts`, inherited
     replace-ref base, or replacement object cannot change results; preflight
     rejects repository replacement sources.

2. Run the snapshot tests and confirm RED:

   ```bash
   npx vitest run tests/opencode-profile/snapshot-tools.test.ts
   ```

3. Implement the three tools with the existing hardened `git()` runner,
   `GIT_NO_LAZY_FETCH=1`, `GIT_NO_REPLACE_OBJECTS=1`, explicit replacement-ref/
   graft preflight, and
   object ids obtained from validated `ls-tree` records. Do not use
   `rev:path`, working-tree filesystem reads, textconv, external diff, user
   regex, or recursive unbounded blob loading.

4. Build a fake child MCP server fixture in the gateway test itself. Write failing tests
   for initialize, requests, responses, notifications, error objects, string and
   numeric ids, progress tokens, and both traffic directions.

5. Add failing authority tests:

   - Every child `tools/list` result is purpose-filtered: run gets
     no-argument `runAuthorizedPipeline` plus three local snapshot schemas,
     doctor gets only
     `doctor`, review gets only `reviewCandidate`, and install probes get only
     their fixed minimum. Cross-purpose calls fail before child forwarding.
   - `decideCandidate`, `integrateCandidate`, unknown future tools, malformed
     names, and non-tool methods that try to smuggle a call are denied before
     child forwarding.
   - Repository-taking calls require the exact canonical bound checkout in the
     expected argument field; omitted, relative, alternate-spelling, sibling,
     symlink, and second-worktree paths fail closed.
   - Immediately before delegation forwarding, hardened Git must still report
     clean `HEAD` equal to the one-shot descriptor's captured OID. Every
     returned candidate/result base OID must equal it; concurrent HEAD drift or
     a race that the runtime observed fails the Host result closed.
   - Child `delegatePipeline` is never listed. The first no-argument
     `runAuthorizedPipeline` call atomically consumes pipeline authority before
     forwarding, reopens and revalidates the private stored spec, requires exact
     Codex preference, and synthesizes exact child input `{checkoutPath, spec,
     protocolVersion}`. Use the bound canonical checkout, stored spec object, and
     release-bound `PROTOCOL_VERSION` from `src/protocol/versions.ts`; never use
     MCP protocol `2025-11-25` in that application field. Any argument,
     concurrent/subsequent call, changed spec file/hash/identity, stale protocol
     value, or consumed token fails before a second baseline command or Producer
     starts.
   - Table-mutate every stored authority field independently: verification
     executable, argv, cwd, environment, network, expected exits/mutations,
     write allowlist, forbidden scope, timeout, output, review policy, Producer
     preferences, and overrides. Every mismatch to the descriptor hash is
     rejected before the private bytes reach the child.
   - Snapshot calls execute locally, use the launcher-captured commit OID, and
     never appear on the child stream.
   - Other allowed forwarded payloads pass through structurally unchanged.

6. Add failing protocol/lifecycle tests:

   - Parent-to-child and child-to-parent pending-id maps are independent.
   - The same id may be outstanding once in each direction, but duplicate ids
     within one direction fail.
   - Only the response matching the gateway's tracked `tools/list` request is
     filtered.
   - Parent requests are limited to `initialize`, `ping`, `tools/list`, and
     `tools/call`; parent notifications to `notifications/initialized` and
     `notifications/cancelled`; child requests to `ping`; and child
     notifications to exact progress used by the runtime. Accept only OpenCode
     1.18.3's exact client capability `{roots:{}}`, terminate it at the gateway,
     and forward an empty client capability object. Accept the pinned runtime
     server's exact `{tools:{listChanged:true}}`, strip `listChanged`, and return
     `{tools:{}}` to OpenCode. Deny actual `roots/list`, roots-list-changed,
     tools-list-changed, resources, prompts, sampling, elicitation, completion,
     logging control, and unknown future methods/capabilities in either
     direction.
   - Both initialize legs require literal MCP protocol version `2025-11-25`
     from pinned `@modelcontextprotocol/sdk@1.29.0`. Reject older supported
     versions, fallback negotiation, a mismatched child initialize result, and
     unknown future versions before any tool call.
   - Captured exact OpenCode 1.18.3 initialize frames and exact pinned-runtime
     initialize frames prove capability normalization. A roots request/
     notification or tools-list-changed notification still fails before
     forwarding.
   - Oversized lines, snapshot lists/blobs/matches, malformed JSON, invalid
     JSON-RPC shape, queue flood, pending-request flood, stderr flood, blocked
     writers, write errors, early child exit, timeout, cancellation, and
     ambiguous shutdown fail closed.
   - Backpressure pauses and resumes the correct source stream.
   - Stdout contains protocol only; bounded redacted diagnostics use stderr.
   - Shutdown forwards termination, escalates after the existing grace, and
     waits for child exit with no orphan.
   - A precreated no-follow mode-`0600` run observation records only
     tool/correlation digest; pipeline status/failure; run id; final candidate
     and final-attempt base/commit/tree/manifest/verified identity; final
     verification classifications and bounded command metadata without output;
     gate reasons; and structured review rounds/findings/dispositions.
   - A separate review-purpose gateway writes only requested run id,
     tool/correlation digest, bounded artifact-inspection changed paths, and
     recomputed hash to its own mode-`0600` review observation. Neither gateway
     writes the launcher composite or modifies the other record. Unknown fields,
     raw prompt/spec/patch/credentials/full payloads/stdout/stderr/evidence/model
     prose, missing/duplicate/cross-purpose calls, and record replacement fail.
   - A no-follow mode-`0600` one-shot descriptor is atomically claimed by one
     gateway and cannot be replayed, reconnected, replaced, extended, or used
     after expiry/lock release. Path+nonce arrive only through the fixed process
     environment; immutable config contains no run-specific OID/path.
   - Pipeline authority is atomically consumed before child forwarding, and
     snapshot entry/blob/match/byte limits are cumulative atomic counters across
     all concurrent calls for the descriptor, not reset per request.
   - The Build-facing schema for `runAuthorizedPipeline` is an exact empty
     object. Fake-provider capture proves verification environment sentinels and
     all other private spec bytes are absent from OpenCode argv, environment,
     prompt, session, schemas, tool arguments, and tool results; only the gateway
     child call receives them. The model-facing result is fixed/minimal; the
     private run observation receives only the closed run projection above.

7. Run and confirm RED:

   ```bash
   npx vitest run tests/opencode-profile/snapshot-tools.test.ts tests/opencode-profile/gateway.test.ts
   ```

8. Implement a line-framed JSON-RPC state machine. Keep policy tables immutable
   and sourced from `contracts.ts`. Spawn only the release-local sibling
   `runtime/bootstrap.mjs`; set
   `CLAUDE_PLUGIN_DATA=<profile>/architect-data`, pass only the separately
   validated canonical `CODEX_HOME` needed by the fixed Codex adapter, use a
   fixed executable PATH, neutral HOME/XDG roots, and remove
   `CLAUDE_ARCHITECT_DELEGATED`.

9. Do not reinterpret runtime success/error payloads or synthesize Candidate
   Artifacts. The gateway filters exposure only.

10. Rerun the narrow tests, type-check, and inspect the gateway output for any
   accidental non-protocol stdout.

## Task 7: Render a reproducible immutable profile release

**Files:**

- Create: `profiles/opencode/BUILD_PROMPT.md`
- Create: `profiles/opencode/RUN_MESSAGE.txt`
- Create: `profiles/opencode/CODEX_AGENT_TOMBSTONE.md`
- Create: `src/opencode-profile/profile-manager.ts`
- Create: `tests/opencode-profile/profile-manager.test.ts`
- Modify: `esbuild.config.mjs`
- Create: `scripts/verify-generated-reproducibility.mjs`
- Generate: `runtime/opencode-mcp-gateway.mjs`
- Generate: `runtime/opencode-profile-watchdog.mjs`

1. Write failing renderer tests for the exact release closure:

   - Gateway/watchdog bundles and an injected static-asset fixture standing in
      for the profile CLI bundle that Task 9 creates after its source exists.
   - The exact provisioned direct OpenCode binary as an executable immutable
     release asset; no npm wrapper, package tree, or lifecycle output is copied.
   - `runtime/bootstrap.mjs`, `runtime/server.mjs`, `runtime/watchdog.mjs`, and
     physical runtime schema files required by role prompts.
   - Generated `opencode.jsonc`, Build prompt, snapshot tool schemas,
     exact run-message literal, canonical OpenCode Codex tombstone, checked
     model catalog, compatibility/retirement manifests, legacy inventory,
     release manifest, and modes.
   - A release-local mode-`0555` XDG cache closure with precreated
     `opencode/bin` and empty `opencode/packages`, no package metadata,
     `node_modules`, model cache, lockfile, or writable entry.

   The tombstone is a static source asset in this task, before Task 8 global
   migration can publish it. It directs project users to the bound profile,
   states pending-only/no integration, and contains no executable shell route.

   `RUN_MESSAGE.txt` contains exactly: `Execute the single authorized pipeline
   operation, wait for its terminal result, then stop. Do not claim acceptance
   or integration.` Hash it as an immutable asset and pass only this text as the
   `opencode run` positional message with child stdin ignored.

2. Write failing non-circular hash tests:

   - Tokenized canonical deployment body produces `deploymentHash`.
   - Final release path is rendered only after that hash exists.
   - Canonical install-manifest body produces `installManifestHash` before only
     its own field is added.
   - Re-rendering is byte-identical. Every path-independent manifest input,
     including bound project and executable identities, is already in the
     deployment-key body; changing one changes `deploymentHash` and therefore
     the final path. Add the regression where two executable identities cannot
     produce different immutable manifest bytes at one release path.
   - An existing immutable release is reused only on complete exact equality
     and is never updated in place.
   - The format-v1 stable launcher contains no release path/version/hash,
     resolves only validated `current.json`, is created only on first install,
     and must remain byte/mode-identical on every format-v1 upgrade.
   - Pure renderer output is identical for two distinct checkout absolute paths;
     no source-worktree path appears in generated bytes/manifests.
   - The reproducibility script rejects an omitted, symbolic, commit, malformed,
     missing, replace-affected, or mismatched tree argument. It accepts only the
     exact object-format-valid `candidateTreeOid` supplied by the frozen
     Candidate Artifact, materializes only that tree, and proves later working-
     tree/index/`HEAD` changes cannot alter either build input.

3. Write failing generated-config tests. The JSONC must contain:

   - A single local MCP entry with immutable key `architect`, targeting the
     release gateway with fixed bound project/profile/release arguments and no
     captured OID, observation path, or other per-run byte.
   - Global default deny and explicit Build allows only
     `architect_runAuthorizedPipeline`, `architect_projectRead`,
     `architect_projectList`, and `architect_projectSearch`. No
     OpenCode agent can call `doctor` or `reviewCandidate`; those are launcher-
     client descriptor purposes only.
   - Explicit denies for built-in read, glob, grep, shell, edit, write, patch,
     task, web, skill, external-directory access, decision, integration, and
     wildcard future MCP tools.
   - Disabled LSP/formatter execution, project file watching, automatic update,
     and automatic downloads not required by the fixed Host flow.
   - Empty plugin/instruction inputs and no external command/tool directories.
   - Exact `enabled_providers` for `anthropic`, `openai`, `opencode`, and
     `openrouter`, the only ids present in the checked model catalog; no
     provider/model definitions, npm/API endpoint overrides, or custom loaders.
     Environment, not config, binds the immutable `OPENCODE_MODELS_PATH`.
   - The generated pending-only Build prompt.

4. Write prompt contract tests proving it may inspect the captured source but
   receives no spec bytes and must call no-argument
   `architect_runAuthorizedPipeline`, keep the call foregrounded, treat its
   minimal result as non-authoritative, and end without an acceptance claim. The
   launcher, not the model, reports reviewer
   findings/artifact evidence and pending status. The model cannot author, view, or alter
   write scope, verification, environment, network, timeout, Producer, shell
   fallback, decision, integration, handoff, or manual patch application.

5. Run and confirm RED:

   ```bash
   npx vitest run tests/opencode-profile/profile-manager.test.ts
   ```

6. Implement the pure renderer before installation logic. Keep deployment
   templates literal and substitute only validated values. Set
   `OPENCODE_CONFIG_DIR` and `$XDG_CONFIG_HOME/opencode` to the same directory
   inside the immutable release. Render that directory mode `0555` with only a
   mode-`0444` `opencode.jsonc` containing `$schema`; no mutable config overlay
   or OpenCode-generated metadata is allowed. Render the hash-verified model
   catalog and empty cache closure into the same immutable release; the mutable
   profile contains no model catalog or package-install cache.

7. Extend `esbuild.config.mjs` with shared Node 22 ESM build settings and
   explicit gateway/watchdog outputs. Preserve the existing CommonJS dependency shim and
   generated-file banner on every bundle. Do not add the profile CLI entrypoint
   before Task 9 creates `cli-entry.ts`, `doctor.ts`, and `launcher.ts`.

8. Generate twice and prove no drift:

   ```bash
   FIRST_BUILD_DIR=$(mktemp -d)
   npm run build
   cp runtime/server.mjs "$FIRST_BUILD_DIR/server.mjs"
   cp runtime/opencode-mcp-gateway.mjs "$FIRST_BUILD_DIR/gateway.mjs"
   cp runtime/opencode-profile-watchdog.mjs "$FIRST_BUILD_DIR/watchdog.mjs"
   npm run build
   cmp -s "$FIRST_BUILD_DIR/server.mjs" runtime/server.mjs
    cmp -s "$FIRST_BUILD_DIR/gateway.mjs" runtime/opencode-mcp-gateway.mjs
    cmp -s "$FIRST_BUILD_DIR/watchdog.mjs" runtime/opencode-profile-watchdog.mjs
    npx vitest run tests/opencode-profile/profile-manager.test.ts
    ```

   This task-local check proves immediate build stability but is not the release
   reproducibility gate. After the implementation is frozen as a Candidate
   Artifact, the final gate must pass that artifact's recorded
   `candidateTreeOid` explicitly to the script. The script has no `HEAD` or
   working-tree default. It materializes that exact tree into two independent
   temporary absolute roots, runs clean locked dependency installs and builds in
   each, verifies all expected generated paths are present in the candidate
   tree, and compares the candidate bytes and both rebuilt copies. It may not
   compare two builds in the same checkout or normalize away path differences.

## Task 8: Implement transactional install, legacy upgrade, and recovery

**Files:**

- Modify: `src/opencode-profile/profile-manager.ts`
- Create or extend: `tests/opencode-profile/profile-manager.test.ts`

1. Write failing new-install tests that snapshot the project tree, `.git`
   metadata, status, index hash, config, refs, and HEAD before and after install.
   Require exact equality and assert all new bytes are under the external
   profile root with restrictive modes.

   Inject a fake `provisionOpenCode` dependency and prove provisioning finishes
   in external temporary state before profile lock/mutation, contributes direct
   package/SRI/extracted/copied binary identities to `deploymentHash`, and is
   skipped only when reusing a completely equal immutable release. Lock/SRI/
   version/digest/copy mismatch or a top-level npm shim leaves profile/project
   bytes unchanged.

2. Write failing upgrade tests for every inventoried release shape. Require:

   - Read-only preflight before lock/mutation.
   - Exact release-owned untracked files backed up externally and removed.
   - Only checked empty plugin-owned directories removed.
   - Unknown, modified, tracked, ignored-user-owned, symlinked, hard-linked,
     special, or identity-raced paths preserved and reported as conflicts.
   - An unrelated dirty path blocks activation.
   - No local exclude, Git config, index, ref, or HEAD mutation.
   - The complete staged closure is atomically published at its final hash path
     while `current.json` still names the prior release or is absent. No process
     executes from the staging path because generated bindings name only the
     final path.
   - Pre-cleanup initialize/tool-surface and post-cleanup full Host validation
     receive transaction-private `CLAUDE_PLUGIN_DATA`, XDG data/state, HOME,
     temp, operations, and synthetic auth roots. Seed live runtime/profile state
     with sentinels and stale recovery records; validation must neither observe
     nor mutate them, project/Git bytes, refs, or worktree administration.
   - No Producer starts during install. A validation failure restores exact
     legacy bytes and prior pointer while the exact unreferenced immutable
     release is either manifest-enumerated away or retained for exact reuse.

3. Add a failpoint after every durable transition in the approved ten-step
   transaction. For each failpoint, restart recovery and assert one of two
   complete outcomes only:

   - Previous current pointer plus exact restored legacy bytes/modes.
   - New validated current pointer plus clean project and no executable old
     route.

   Contradictory journal, backup, inode, hash, pointer, or stage evidence must
   return `recovery-required` without guessing or deleting.
   On first-install rollback, remove only the just-created exact launcher; on
   upgrade, prove no launcher write occurs. Include tampered/changed launcher as
   a preflight conflict rather than attempting replacement.

   Add the parallel global-destination transaction fixture under an external
   `opencode-global-migrations/<destination-key>/` root. It has a separate
   no-follow lock/journal/backups and no nested profile lock. Preflight every
   conflict before mutation; remove the exact owned Codex wrapper first,
   fsync a forward-only commit marker, atomically publish the tombstone second,
   then publish other exact managed Pi/Pythinker assets. Before wrapper-removal
   commit, rollback may restore the complete prior set. After commit, wrapper
   restoration is forbidden: recovery must finish the complete new global set
   or remain `recovery-required` with Codex unavailable. Test every failpoint and
   prove no post-commit state regains an executable owned Codex shell route.

4. Add concurrent installer/operation tests proving one shared profile-operation
   lock winner, no install/recovery/auth/doctor/run/review overlap, deterministic
   `profile-busy` before OpenCode starts, no mixed release, no partial current
   release, no lost backup, and rerunnable exact success. Define one acquisition
   order: resolve and read-only preflight, then profile-operation lock, then
   revalidation, then any existing runtime repository lock inside the delegated
   call. Never acquire the profile lock while holding a runtime repository lock.
   Add equivalent one-winner, dead-owner, rollback, and recovery tests for the
   separate global-destination lock, and prove global/profile locks are never
   nested.

5. Run and confirm RED:

   ```bash
   npx vitest run tests/opencode-profile/profile-manager.test.ts
   ```

6. Implement the default root and binding exactly as designed:

   ```text
   ${XDG_DATA_HOME:-$HOME/.local/share}/claude-architect/opencode-profiles/<project-key>/
   ```

   Record canonical worktree root, canonical Git common directory, canonical
   per-worktree Git directory, `.git` directory/gitfile binding, no-follow root
   identities/link counts, separately validated canonical Codex credential home
   and auth-file identity, Codex/Node/Git resolved executable identities/hashes/
   versions, and both release hashes. Never copy/read/hash credentials. Missing
   Codex edit eligibility or unsafe auth/executable state blocks installation
   before profile mutation.

7. Implement the journaled transaction in the approved order. `current.json`
   is the last activation write. Use external backups for legacy bytes and
   restore exact bytes/modes on ordinary failure. Recovery must validate before
   completing or restoring. Publish only the fully fsynced immutable closure to
   its final path before process checks; never execute a staged binding. Express
   the two final-path, transaction-private no-model Host proofs as required
   injected `validateReleaseSurface` and `validateReleaseHost` dependencies in
   this task; tests use deterministic fakes that assert every private root and
   reject live-state access. Task 9 supplies the real gateway/doctor/OpenCode
   implementations and reruns the transaction integration tests with them.

8. Expose the install/global-migration operations as typed functions with
   dependency injection and test them directly. Do not modify the public Bash
   installer or generate a CLI before Task 9 creates and tests the command
   entrypoint.

9. Rerun the narrow tests plus a real temporary Git worktree integration test.

## Task 9: Implement doctor and the fixed launcher

**Files:**

- Create: `src/opencode-profile/doctor.ts`
- Create: `src/opencode-profile/launcher.ts`
- Create: `src/opencode-profile/mcp-client.ts`
- Create: `src/opencode-profile/cli-entry.ts`
- Create: `tests/opencode-profile/doctor.test.ts`
- Create: `tests/opencode-profile/launcher.test.ts`
- Create: `tests/opencode-profile/mcp-client.test.ts`
- Create: `scripts/resolve-opencode-host-gate.mjs`
- Modify: `esbuild.config.mjs`
- Modify: `scripts/install-opencode.sh`
- Modify: `tests/install-opencode.test.sh`
- Generate: `runtime/opencode-profile-cli.mjs`

1. Write failing doctor tests using a fake OpenCode executable that records
   argv/env/cwd without starting a model. Doctor must validate before success:

   - Non-root effective identity, stable launcher, `current.json`, release
     manifest, deployment hash, every
     immutable byte/mode, and the single-file read-only config directory.
   - Bound project/Git paths and identities, HEAD, exact clean status, profile
     roots, lock/journal state, Node identity/version, and exact OpenCode
     identity/version.
   - Recorded Codex/Git/Node executable identities/hashes/versions, canonical
     `CODEX_HOME` and auth-file identity/mode without reading secret bytes,
     minimal collision-free PATH, and an unchanged edit-eligible Codex
     capability report.
   - Required disable flags; exact equality of `OPENCODE_CONFIG_DIR` and
     `$XDG_CONFIG_HOME/opencode`; absent isolated `$HOME/.opencode`; absent
     system-managed config/preferences; absent or exact four-provider API auth
     records only;
     no active account/org config; and absence of inherited config/plugin/skill,
     provider-secret, credential, shell, and delegation variables, including
     `OPENCODE_AUTH_CONTENT`.
   - Exact static model-catalog hash/read-only path, four enabled providers, no
     config-defined provider/model/npm/endpoint, and only absent or exact API
     auth records. Doctor does not require inactive providers to appear in
     `models --verbose`.
   - Release-local XDG cache identity/modes with empty package/bin closure and
     no model cache, package metadata, `node_modules`, lockfile, import hook, or
     package-manager override before and after every no-model/fake-model probe.
   - `opencode debug config --pure`, `opencode debug agent build --pure`, MCP
     connection/list, and a launcher-MCP-client direct `doctor` call.
   - Debug-agent output proves built-in denial; the exact fake-provider model
     request proves only the four `architect_*` Build names. OpenCode has no
     doctor/review tool; those exist only in purpose-filtered launcher-client raw
     gateway lists.

2. Add malicious discovery sentinels in the project, isolated/global/home,
   managed-config, managed-preference, auth, and account roots: `.opencode`
   config/custom tools/plugins/agents/skills/commands, root OpenCode config,
   `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, external skills, default plugins,
   well-known remote config, active organization config, provider config, and
   credentials. Each executable sentinel attempts to write a marker. Doctor and
   run must reject before OpenCode when preflight can detect the source and must
   never load or execute any sentinel.

3. Add exact OpenCode 1.18.3 regression fixtures for both source-confirmed read
   attacks: an in-project symlink whose target is outside the checkout and a
   regular tracked file beneath a nested malicious `AGENTS.md`/`CONTEXT.md`.
   Built-in `read`, `glob`, and `grep` must be absent/denied; the three snapshot
   tools must reject the symlink and return regular blob content without
   attaching nested instructions.

   Also run exact OpenCode 1.18.3 against a local fake provider endpoint that
   captures the complete model request. Assert the system input excludes every
   project/global/home/managed `AGENTS.md`, `CLAUDE.md`, and `CONTEXT.md`
   sentinel while retaining only the generated Build prompt. This proves
   non-loading; marker-file non-execution alone is insufficient. Use a test-only
   catalog tuple whose endpoint is the local capture server but whose SDK key is
   one allowed bundled key. Keep the package/cache closure read-only and snapshot
   it before/after. Add rejected fixtures for `file://`, an unbundled package,
   a versioned package, a config-shadowed model, a cached catalog, and a changed
   endpoint; no fixture may create/import a sentinel or attempt registry access.

4. Write failing immutable-config tests. Reject effective uid 0. For a non-root
   owner, allow only the same-owner mode-`0444` `opencode.jsonc` in its
   same-owner mode-`0555` release directory. Reject changed JSONC,
   any extra file or directory, writable owner/group/other bits, executable
    content, instructions, tool/plugin/agent/skill/command directories, symlinks,
    special files, multiply linked files, and owner/identity drift. Apply the
    same identity/mode check to `models.v1.json` and the read-only cache closure.
    The exact real OpenCode 1.18.3 no-model probe must succeed and leave the
    complete config/catalog/cache closure byte-for-byte unchanged with no
    `.gitignore`, model cache, package metadata, lockfile, or `node_modules`.

5. Write failing launcher grammar/argv tests:

   - `auth --provider <id>` accepts exactly `anthropic`, `openai`, `opencode`, or
     `openrouter`; reads one bounded key only from an echo-disabled controlling
     TTY; restores TTY state on success, error, signal, and timeout; starts no
     child/network/browser; and writes exact `{type:"api",key}` only under
     `xdg-data/opencode/auth.json`. It never accepts a key, URL, or method on
     argv, redirected stdin, environment, or config. Test no-follow mode-`0600`/
     Windows ACL temp-write, fsync, atomic rename, parent fsync, merge of valid
     allowed entries, malformed/unknown/OAuth/well-known/metadata rejection, and
     redaction of key bytes from every result/error/log.
   - `doctor` never invokes a model or Producer.
   - `run` first performs all doctor checks, then invokes fixed `opencode run`
     with `--pure`, `--format json`, fixed `--agent build`, fixed canonical
      `--dir`, exact catalog-member model/optional variant, one reviewed literal
      message from immutable profile assets, child stdin closed/ignored, and no
      `--auto`. Bind catalog hash/provider/model/variant/SDK/endpoint in the
      one-shot descriptor. The consumed authorized-spec stdin is never forwarded
      or reused.
   - Before model start, require the selected provider's exact API record and run
     bounded `opencode models <provider> --verbose` under the fixed environment;
     compare only that provider's projection with its static catalog subset. A
     syntactically valid but unlisted provider/model/variant, changed endpoint or
     npm key, non-bundled/versioned/path/URL/`file://` SDK, live/cached catalog,
     package-root content, or selected-provider projection mismatch fails before
     OpenCode model/Producer start.
   - Resolve and identity-bind every verification executable from the authorized
     spec before OpenCode starts, construct the exact recorded PATH, and require
     runtime Producer/verification resolution evidence to match. A model cannot
     add a PATH directory or executable.
   - Before run, the launcher strictly validates/canonicalizes stdin as a full
     version-1 Delegation Spec, requires every authority-bearing field
     (write/forbidden scope, verification executable/argv/environment/network,
     timeout, expected output, review policy, and exactly Codex preference),
     stores mode-`0600` canonical bytes, and binds their hash in each relevant
     descriptor. Free text or a semantically changed model tool call is denied.
   - `review` performs all doctor checks, then uses the launcher MCP client to
     initialize the watched gateway and issue exactly one
     `reviewCandidate({runId})`; doctor issues exactly one `doctor({})`. No
     OpenCode/model process, caller-selected method/tool id, second call, or
     generic debug argv is accepted.
   - Unknown/reordered/repeated flags, raw argv, stdin overflow, unsupported
     platform/version, dirty project, profile drift, and child failure return a
     stable unavailable envelope and start no model/Producer.
   - The shared profile-operation lock serializes install/recovery,
     `auth`, `doctor`, `run`, and `review`; a contender returns `profile-busy`
     before OpenCode/model/Producer start.
   - After model exit, the launcher validates and seals the exact run
     observation. Only an eligible run causes creation of a separate review
     descriptor/observation and one direct review call. After validating that
     record, the launcher fsyncs a third canonical composite envelope. Model text
     is at most a bounded explicitly `untrustedSummary`; accepted/integrated
     claims cannot alter or appear as authoritative status. Missing/mismatched
     review evidence is failure, not pending success.
   - Pending eligibility requires pipeline status `decision-ready` or
     `human-decision-required`, null failure, verified candidate, passing non-null
     final verification, complete reviewer rounds, and exact final commit/base/
     tree/manifest correlation across archive, run observation, review
     observation, and composite. Preserve
     pipeline status, gate reasons, findings, dispositions, final verification,
     and artifact evidence in the bounded envelope. A failed/unverified archive
     that `reviewCandidate` can read is still failure.
   - Correlate with existing fields only: require private pipeline `runId`,
     `finalCandidateCommit`, and `attempt.candidate` commit/base/manifest fields
     to agree; invoke artifact inspection with that exact run id; hash its
     ordered `changedPaths` with the runtime's existing JSON/SHA-256 rule; and
     require the recomputed value to equal the candidate manifest. Bind both
     observation file identities/hashes in the composite. Mutation/replacement
     of either after validation fails. Do not claim
     the current review output exposes OIDs or add protocol fields in this scope.
   - Cover missing/duplicate observations, cross-run/release/project identities,
     wrong final commit/base/tree/manifest or changed-path hash, ineligible run
     with readable artifact, review-before-run, observation replacement after
     validation, and composite write failure. None can produce pending status.
   - Once the model subprocess exits with a valid pipeline observation, the
     launcher creates a separate review-purpose descriptor and invokes the
     bounded MCP client without OpenCode/model. The Build model cannot call
     `doctor` or `reviewCandidate`; artifact inspection is launcher-owned.
   - The launcher MCP client uses only bounded initialize, initialized
     notification, purpose-filtered tools/list, one exact tools/call, correlated
     response/error, and shutdown at exact protocol `2025-11-25`. Server
     requests, fallback/other protocol versions, extra notifications,
     capability drift, wrong/duplicate ids, second calls, malformed/oversized
     frames, timeout, and child leaks fail closed.

6. Run and confirm RED:

   ```bash
   npx vitest run tests/opencode-profile/doctor.test.ts tests/opencode-profile/launcher.test.ts tests/opencode-profile/mcp-client.test.ts
   ```

7. Implement doctor as explicit checks with bounded evidence. Do not infer
   safety from exit code alone; parse and compare effective config/agent/tool
   output against the exact expected set.

8. Implement launcher dispatch with no extension hook and no raw argument
   forwarding. Revalidate the profile and clean checkout on every operation,
   including after acquiring the profile-operation lock and immediately before
   model start. Capture clean `HEAD` once at that final boundary, write the
   canonical authorized spec plus disjoint one-shot run descriptor/observation,
   later review descriptor/observation, and launcher-only composite path under
   `operations/`, and pass only the currently active
   descriptor path+nonce through the fixed environment. Snapshot tools never
   accept a caller revision. Remove completed descriptors only after the
   composite or terminal failure envelope and all referenced hashes are fsynced;
   preserve bounded failed evidence per retention policy.

9. Before declaring launcher behavior green, implement the checked Host-gate
   platform selector, provision the Task 2 lockfile with lifecycle scripts
   disabled, select the direct macOS-arm64 or baseline glibc-Linux-x64 package
   binary, validate the static `models.v1.json` with one transaction-private
   synthetic API record per provider, and run exact OpenCode 1.18.3 immutable-
   config, effective-agent, MCP-method, selected-provider catalog, read-only
   package/cache, fake-provider prompt/session/tool-result, and no-model tool
   tests. Assert the fixed reviewed run message is the only caller-controlled
   user message and the generated Build prompt is the only project instruction;
   separately pin expected OpenCode-generated system/tool content. Child stdin
   is closed and no authorized-spec byte or sentinel reaches OpenCode. Assert no
   dynamic package/file import, registry request, cache mutation, or catalog
   refresh. This gate must pass before installer migration or shell retirement.

   Use the same checked provisioner for real installation: isolated external npm
   HOME/cache/config, exact lockfile URLs/SRIs, no credentials/proxy/hooks,
   bounded `npm ci --ignore-scripts --no-audit --no-fund`, direct package
   selection, extracted SHA-256, release copy, copy rehash, and final `--version`.
   Every installed launcher operation resolves only the release-local binary.

10. Return the launcher's stable path from installation and print exact usage,
   profile location, bound project, OpenCode version, and separate-auth next
   step. Do not print credentials or sensitive environment values.

11. Implement `cli-entry.ts` as the exact shared dispatch seam for internal
   `install --project`, internal global migration, and installed launcher
   `auth/doctor/run/review` modes. It imports the already tested profile-manager
   operations and launcher; unknown mode/argv fails before mutation.

12. Add the now-existing CLI entrypoint to `esbuild.config.mjs`, generate
   `runtime/opencode-profile-cli.mjs`, and rerun the renderer test with the real
   generated bytes instead of its injected fixture.

13. Replace the Bash project installer body with a bounded Node bootstrap that
   resolves the checked generated CLI and invokes:

   ```text
   node runtime/opencode-profile-cli.mjs install --project <root>
   ```

   Preserve the existing public `scripts/install-opencode.sh --project <root>`
   syntax. Do not allow raw forwarded arguments. Route `--global` through the
   bounded generated CLI operation that preserves existing Pi/Pythinker asset
   installation, replaces an exact owned Codex agent with the tombstone, and
   removes an exact owned copied Codex wrapper. Preserve and report modified or
   user-owned global Codex files; no active resolver may reference them.

14. Rewrite `tests/install-opencode.test.sh` at the installer change boundary to
   assert zero project assets plus external profile creation, the exact retained
   global set, canonical tombstone, no global Codex wrapper, owned cleanup,
   preservation conflicts, and global transaction recovery. Preserve unrelated
   Pi/Pythinker coverage. Then rerun doctor, launcher, profile-manager,
   generated-build, project-install, and global-migration tests together.

## Task 10: Migrate Host prompts without enabling acceptance

**Files:**

- Modify: `.opencode/agents/codex-implementer.md`
- Modify: `.opencode/agents/pi-implementer.md`
- Modify: `.opencode/agents/pythinker-implementer.md`
- Modify: `agents/codex-implementer.md`
- Modify: `skills/delegate/SKILL.md`
- Create: `tests/opencode-profile/host-contract.test.ts`
- Modify: `tests/delegate-routing.test.mjs`
- Modify: `tests/lane-model-fallback.test.mjs`
- Modify: `tests/runtime/plugin-wiring.test.mjs`
- Modify: `tests/codex-lifecycle.test.sh`
- Modify: `tests/lane-contract.test.mjs`

1. Write failing static/contract tests proving:

   - Neither active agent invokes `run-codex-isolated.sh`, raw Codex, manual
     worktree lifecycle, manual patch application, or shell fallback.
   - Claude's tombstone directs users to
     `/claude-architect:delegate` and does not change the existing complete MCP
     lifecycle or tool namespace.
   - OpenCode's tombstone directs users to the printed external launcher and
     says candidates remain pending and cannot be accepted/integrated there.
   - `skills/delegate/SKILL.md` distinguishes Claude's complete lifecycle from
     OpenCode's compatibility lifecycle and never claims OpenCode Host
     certification.
   - Runtime blockers produce unavailable/failure guidance, not fallback.
   - Existing delegate-routing, lane-model-fallback, and plugin-wiring suites
     expect tombstones/MCP routing rather than executable Codex shell agents,
     while preserving all unrelated Producer assertions.
   - Split `tests/codex-lifecycle.test.sh` and `tests/lane-contract.test.mjs`
     assertions at this task boundary: replace only agent/skill routing content
     that tombstoning changes, while retaining direct wrapper characterization,
     hidden-option, timeout, cleanup, and lane-mode tests until Task 12 deletes
     the wrapper.
   - Project mode's exact post-migration set is empty. Global mode's exact set
     is Codex tombstone, Claude advisor, Pi/Pythinker agents, delegate skill,
     and `run-isolated.sh`, `run-opencode-isolated.sh`, `run-pi-isolated.sh`,
     and `run-pythinker-isolated.sh`, with no Codex wrapper. Pi/Pythinker agents
     advertise global installation or source-checkout development only; migrate
     their resolver/install tests explicitly.

2. Run and confirm RED:

   ```bash
   npx vitest run tests/opencode-profile/host-contract.test.ts
   ```

3. Replace both long executable Codex agent bodies with concise read-only
   migration notices. Make `.opencode/agents/codex-implementer.md` byte-identical
   to `profiles/opencode/CODEX_AGENT_TOMBSTONE.md`; use the separate Claude MCP
   notice for `agents/codex-implementer.md`. Preserve filenames for the
   compatibility window.

4. Update the skill's active route. Keep all existing Delegation Spec,
   independent review, human decision, and exact-hash Controlled Integration
   requirements for Claude Code. Add the bounded OpenCode flow only as a
   separate pending-only section.

5. Rerun the test and validate the plugin:

   ```bash
   npx vitest run tests/opencode-profile/host-contract.test.ts
   node tests/delegate-routing.test.mjs
   node tests/lane-model-fallback.test.mjs
   npx vitest run tests/runtime/plugin-wiring.test.mjs
   bash tests/codex-lifecycle.test.sh
   node tests/lane-contract.test.mjs
   claude plugin validate --strict .
   ```

## Task 11: Prove installed lifecycle, concurrency, and no mutation

**Files:**

- Create: `tests/opencode-profile/lifecycle.test.ts`
- Extend: profile fake executable fixtures within the test directory

1. Build the real generated profile CLI and gateway. Install into a temporary
   external profile for a temporary clean Git project. Use fake OpenCode and
   fake Codex executables, but use the real launcher, profile renderer, gateway,
   `runtime/bootstrap.mjs`, bundled server, runtime, worktree creation,
   verification, archive, and cleanup.

2. Add the successful compatibility flow:

   - Install with zero new project/Git bytes.
   - Authenticate only under profile data.
   - Doctor with no model.
   - Supply a human-authorized canonical edit Delegation Spec to the launcher
     and prove the model receives none of its private bytes, calls only
     no-argument `architect_runAuthorizedPipeline`, OpenCode maps that to raw
     gateway tool `runAuthorizedPipeline`, and the gateway forwards the stored
     exact spec through child `delegatePipeline` once.
   - Keep the call foregrounded to terminal result.
   - Extract structured independent findings from `delegatePipeline`; after the
     model exits, have the launcher use its bounded MCP client and a separate
     descriptor to call `reviewCandidate` only for frozen artifact/evidence
     inspection, with no OpenCode/model process.
   - Report exact run id, manifest hash, pipeline findings, and launcher-authored
     `pending-human-decision` from matching gateway evidence, even if the fake
     model claims acceptance.
   - Confirm no decision record, integration, main-checkout edit, or manual
     patch application.

3. Add same-profile and cross-profile concurrency cases. Two same-profile
   invocations race for the operation lock: exactly one may start and the other
   returns `profile-busy` before OpenCode/model/Producer launch. Then run two
   separately installed profiles concurrently with distinct prompts and edits;
   assert their gateway instances cannot exchange ids, progress, worktrees,
   logs, archives, patches, candidates, stderr, or final reports. Existing
   runtime repository locks may serialize calls against one repository, but no
   Host/profile stream may be shared.

4. Add fail-closed lifecycle cases:

   - Zero edit and edit success.
   - Timeout before edit and timeout after edit.
   - Cancellation and process-tree cleanup.
   - SIGKILL of launcher and gateway with watchdog cleanup, plus watchdog-death
     lock-reclamation refusal while any recorded child remains alive/ambiguous.
   - Dirty checkout and stale base.
   - Invalid protocol and oversized gateway data.
   - Missing/tampered runtime or profile bytes.
   - Nested delegation marker.
   - Unsupported platform/OpenCode/Node.
   - Ineligible confinement.
   - Producer self-report contradicting frozen artifact.
   - Pipeline `failed`, non-null failure, missing/failed verification,
     incomplete final review, gate reasons/dispositions, final-commit mismatch,
     wrong base/manifest, and a readable but ineligible archived candidate.
   - Free-text stdin and a prompt-injected model attempting to replace any
     verification/scope/environment/network/timeout/Producer field; assert no
     baseline command or Producer starts and only stored exact bytes can reach
     the runtime.
   - Forbidden decision/integration and alternate checkout calls.

5. Snapshot the main project and Git metadata around every case. Install and
   auth require byte equality. Doctor and review require equality when no stale
   runtime recovery is pending; recovery cases may remove only exact
   runtime-owned stale worktree administration. Run requires equality for main
   worktree bytes/status, index, HEAD, config, and non-runtime refs; permit only
   recovery plus added Git objects, a matching
   `refs/claude-architect/candidates/<run-id>`, and temporary worktree
   administration that is gone at terminal completion. A failure may leave
   durable redacted profile/runtime evidence defined by existing recovery, but
   never a main-checkout edit, partial active release, accepted status, or shell
   fallback.

6. Run:

   ```bash
   npm run build
   npx vitest run tests/opencode-profile/lifecycle.test.ts
   ```

7. Add opt-in real OpenCode `1.18.3` and real provider/Codex smoke tests only
   behind explicit environment gates. Record exact executable versions, model,
   platform, and confinement. A smoke pass does not expand certification.

## Task 12: Retire the shell route and enforce release gates

**Files:**

- Delete: `scripts/run-codex-isolated.sh`
- Modify: `scripts/install-opencode.sh`
- Modify: `tests/codex-lifecycle.test.sh`
- Modify: `tests/lane-contract.test.mjs`
- Modify: `tests/runtime/isolated-scripts.test.ts`
- Modify: `tests/install-opencode.test.sh`
- Modify: `tests/claude-runtime-resolver.test.sh`
- Create: `tests/opencode-profile/retirement.test.ts`
- Modify: `scripts/validate-release.sh`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/validate-release.test.sh`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/PRIVACY.md`
- Modify: `docs/ARCHITECTURE.md`, `docs/operations.md`,
  `docs/PLUGIN_COMPONENTS.md`, `docs/SECURITY_MODEL.md`,
  `docs/THREAT_MODEL.md`, `docs/TRUST_BOUNDARIES.md`, and
  `docs/MARKETPLACE_REVIEW.md`
- Modify: each exact historical-reference file listed in Task 2, adding only the
  checked retirement marker where otherwise unchanged
- Modify: `CHANGELOG.md`
- Modify when release version is selected: `.claude-plugin/plugin.json`
- Modify when release version is selected: `.claude-plugin/marketplace.json`
- Modify when release version is selected: `src/protocol/versions.ts`
- Modify when release version is selected: version assertions in
  `tests/runtime/plugin-wiring.test.mjs`

1. First run Tasks 1 through 11 together. Do not begin deletion if any
   replacement gate is skipped, flaky, or failing.

2. Before the retirement scan, add documentation contract assertions to
   `tests/opencode-profile/host-contract.test.ts` and update every active doc.
   Cover exact install/launcher/auth/doctor/run/review commands; human-authorized
   private spec handling; six-tool total and purpose subsets; immutable profile,
   data/credential/retention/cleanup locations; exact OpenCode/platform and four-
   provider checked-model-catalog support; lockfile-pinned install-time registry
   access and offline exact-release reuse;
   pending-only authority; Claude's unchanged complete lifecycle; project/global
   legacy cleanup and conflicts; watchdog/recovery behavior; and residual trust.
   Remove active shell-route instructions while retaining clearly historical
   changelog text. If the human has selected the migration release version,
   synchronize plugin/marketplace manifests, README badge, first changelog
   heading, `RUNTIME_VERSION`, and pinned plugin-wiring assertions under the
   minor-only release rule.

3. Write a failing retirement test that loads and strictly validates
   `retirement-policy.v1.json`, requires an explicit injected frozen tree OID,
   enumerates every regular textual blob in that tree through hardened Git
   object reads, and searches those bytes for:

   - Executable references to `run-codex-isolated.sh`.
   - Active Codex shell fallback/resolver instructions.
   - Raw `codex exec` edit-lane construction outside the unchanged Codex
     Producer adapter.
   - OpenCode decision/integration or manual patch application claims.
   - Project-local Codex MCP installation.

   There is no directory-wide documentation exception. Require every exact
   historical file to exist and carry the policy marker in its first 20 lines;
   fail on a matching reference in any unlisted plan/spec. Search every
   non-historical textual blob for both Markdown links and raw path strings
   naming a historical file, and fail every inbound direction to retained shell
   instructions. Permit only strict-parser-identified control-value byte spans;
   scan the remainder of the policy and all scanner/test source. Add bypass
   fixtures for a token outside/overlapping an approved span, extra surrounding
   command text, duplicate/reordered JSON, and dynamically derived test strings.
   Add fixtures for
   each previously omitted class: root `CLAUDE.md`, root `CONTEXT.md`,
   `SUPPORT.md`, `scratchpad.md`, `native/*.md`, a generated runtime file, an
   extensionless file, and a new directory. Add Markdown/source fixtures with
   NUL, C0/DEL, invalid UTF-8, misleading binary extensions, and forbidden ASCII
   bytes inside otherwise binary data; textual invalidity is rejected and raw
   forbidden bytes are never skipped.

   Add canonical/non-canonical legacy-inventory fixtures proving the exact
   wrapper path is accepted only at the approved ownership-data JSON pointer and
   remains available to upgrade classification. The same token in another
   field/file, an active manifest/resolver, generated runtime, or an executable
   string fails.

   Parse `CHANGELOG.md` headings rather than excluding the whole file.
   `[Unreleased]` has no exemption. A released paragraph may retain a
   non-executable shell-history reference only when it contains the exact
   retirement marker; code fences, command-prefixed lines, links to historical
   instructions, resolver/fallback language, and raw edit-lane construction
   still fail. The current migration entry should say that the legacy Codex
   shell route was retired without naming an executable path, so it needs no
   exception before release.

   Treat all three exact compatibility tombstones as active content. Assert
   their bounded canonical migration text and absence of wrapper/raw-Codex,
   resolver, decision, integration, handoff, and manual-application language;
   only their filenames are retained for compatibility.

4. Run and confirm RED while the wrapper still exists:

   ```bash
   npx vitest run tests/opencode-profile/retirement.test.ts
   ```

5. Delete `scripts/run-codex-isolated.sh`, remove it from every installer and
   active packaging/resolver surface, but retain every historical wrapper
   tag/path/hash/mode record in `legacy-assets.v1.json` so upgrade cleanup remains
   safe. Replace obsolete shell tests only where the profile suite now proves the
   same property. Preserve unrelated isolation/lane tests.
   `.claude-plugin/plugin.json` has no component or asset list and changes only
   if the human selects the synchronized release version.
   Retain Task 9's migrated `tests/install-opencode.test.sh` project/global
   assertions and explicitly migrate `tests/claude-runtime-resolver.test.sh`
   Codex cases; do not leave them to fail implicitly in the full suite. Keep
   global Pi/Pythinker installer/resolver behavior covered, and keep exact owned
   global Codex cleanup plus preservation conflicts green.

6. Extend release validation to require, in order:

   - Clean generated profile/runtime assets.
   - Strict TypeScript.
   - Strict test TypeScript through `npm run typecheck:tests`.
   - Full Vitest and shell/contract suites.
   - Legacy inventory regeneration from every pinned project-installer tag from
     `v0.5.0` through `v0.19.0`, including retained wrapper ownership records,
     and supported-tag fixture coverage.
   - New install/upgrade/recovery gates.
   - Exact real OpenCode `1.18.3` Host gate installed from
     `opencode-ai@1.18.3` only after its registry integrity equals the checked
     compatibility value; otherwise release validation fails rather than
     certifying an untested version.
   - Static `models.v1.json` schema/hash/provenance validation, one private
     synthetic API-record projection probe per provider, no live refresh, and
     passing immutable package/cache plus dynamic-SDK denial probes.
   - Claude plugin validation.
   - Retirement scan.
   - Existing synchronized release-version surfaces.

7. Update `.github/workflows/ci.yml` to use full tag history for release
   validation by setting `actions/checkout@v5` `fetch-depth: 0`, provision the
   integrity-pinned OpenCode package on macOS-arm64/glibc-Linux-x64, selecting
   `opencode-linux-x64-baseline@1.18.3` on Linux, run the real Host gate there,
   and run only the pre-spawn unsupported-platform
   contract on Windows. Do not download/execute OpenCode on the Windows lane.

   The POSIX provisioning step must copy the checked
   `profiles/opencode/host-gate/package.json` and lockfile to an isolated
   temporary directory, run exact `npm ci --ignore-scripts --no-audit --no-fund`,
   then invoke `scripts/resolve-opencode-host-gate.mjs <install-root>`. The
   checked selector maps only compatibility-manifest OS/arch/libc tuples to
   `node_modules/opencode-<platform>/bin/opencode`, verifies that package's exact
   version/SRI-derived installed identity, and rejects the top-level
   `node_modules/.bin/opencode` postinstall stub. Require the selected binary's
   `--version` to equal `1.18.3`. The lockfile pins the full platform-optional
   dependency closure and every SRI. Add selector, exact command/ordering, stub-
   rejection, and lock-drift assertions to `tests/validate-release.test.sh`; do
   not run lifecycle scripts or rely on `npm view`, a floating global install,
   live models.dev, or registry metadata as the authority record. Validate the
   checked static catalog and run each private selected-provider projection plus
   package-cache Host probe before any real-model smoke.

8. Run the retirement and prior characterization suites. Update any test name
   that still describes the historical exit-65 command as current.

## Task 13: Audit documentation and release surfaces

**Files:** Verify every documentation/version file changed in Task 12.

1. Run the documentation/Host contracts and retirement scan after shell
   deletion. Confirm every regular textual blob in the frozen candidate tree was
   classified/scanned, every retained historical reference is exact-listed and
   marked, released changelog exceptions are paragraph-scoped, and no
   non-historical inbound link reaches a retained shell instruction. Confirm
   privacy, credentials, retention, authority, support, and cleanup claims match
   executable contracts exactly.

2. If a release version was selected, run the existing synchronized-version
   validator and `tests/runtime/plugin-wiring.test.mjs`. If no release version
   was selected, verify Task 12 did not invent or partially advance one.

## Task 14: Full verification and independent acceptance review

**Files:** All changed and generated files.

1. Regenerate all assets and require no generated diff after the second build:

   ```bash
   FIRST_BUILD_DIR=$(mktemp -d)
   node scripts/generate-opencode-legacy-inventory.mjs
   npm run build
   cp runtime/server.mjs "$FIRST_BUILD_DIR/server.mjs"
   cp runtime/opencode-profile-cli.mjs "$FIRST_BUILD_DIR/profile-cli.mjs"
   cp runtime/opencode-mcp-gateway.mjs "$FIRST_BUILD_DIR/gateway.mjs"
   cp runtime/opencode-profile-watchdog.mjs "$FIRST_BUILD_DIR/watchdog.mjs"
   npm run build
   cmp -s "$FIRST_BUILD_DIR/server.mjs" runtime/server.mjs
   cmp -s "$FIRST_BUILD_DIR/profile-cli.mjs" runtime/opencode-profile-cli.mjs
   cmp -s "$FIRST_BUILD_DIR/gateway.mjs" runtime/opencode-mcp-gateway.mjs
   cmp -s "$FIRST_BUILD_DIR/watchdog.mjs" runtime/opencode-profile-watchdog.mjs
   git ls-files --error-unmatch runtime/server.mjs runtime/opencode-profile-cli.mjs runtime/opencode-mcp-gateway.mjs runtime/opencode-profile-watchdog.mjs profiles/opencode/legacy-assets.v1.json profiles/opencode/legacy-source-tags.v1.json
   git diff --exit-code -- runtime/server.mjs runtime/opencode-profile-cli.mjs runtime/opencode-mcp-gateway.mjs runtime/opencode-profile-watchdog.mjs profiles/opencode/legacy-assets.v1.json profiles/opencode/legacy-source-tags.v1.json
    test -n "${CLAUDE_ARCHITECT_CANDIDATE_TREE_OID:-}"
    node scripts/verify-generated-reproducibility.mjs --tree "$CLAUDE_ARCHITECT_CANDIDATE_TREE_OID"
    ```

   For Candidate Artifact review, the trusted review harness sets
   `CLAUDE_ARCHITECT_CANDIDATE_TREE_OID` from the artifact's recorded
   `candidateTreeOid` only after proving the review checkout is clean, its
   `HEAD` equals the artifact's `candidateCommitOid`, and that commit resolves
   to the same tree. The script never derives a default from live `HEAD`. In CI,
   a trusted setup step derives and exports the exact tree OID from immutable
   `$GITHUB_SHA` after requiring a clean checkout. An absent or mismatched value
   fails before dependency installation or build.

2. Run narrow profile suites first, then all repository gates:

   ```bash
   npx vitest run tests/opencode-profile
   npx tsc --noEmit
   npm run typecheck:tests
   npx vitest run
   bash tests/codex-lifecycle.test.sh
   node tests/lane-contract.test.mjs
   bash scripts/validate-release.sh
   claude plugin validate --strict .
   ```

   If retirement intentionally removes a command, replace that command in this
   list with the new retirement/lifecycle command in the same change and state
   why. Do not silently skip it.

3. Run platform coverage on macOS-arm64 and glibc-Linux-x64 with exact
   integrity-pinned OpenCode 1.18.3 and the baseline Linux x64 binary. Run every
   unsupported-tuple test, including Windows, in Windows CI and assert no
   mutation/process launch before the classification.

4. Inspect status and the complete diff. Every changed line must map to this
   plan. Preserve unrelated user changes and do not stage them.

5. Request two independent read-only reviews of the complete candidate bytes:

   - Security/trust-boundary review focused on profile escape, OpenCode
     discovery, permissions, gateway protocol, identity, credentials,
     installation, lock/recovery, cleanup, and no decision/integration.
   - Acceptance review focused on the design criteria, cross-platform behavior,
     generated assets, docs, and test evidence.

6. Fix every Critical and Important finding test-first. After any fix, rerun
   the affected narrow test and the complete gate set. Reviewers recommend;
   only the human may accept or integrate the resulting candidate.

## Final evidence checklist

- Current shell characterization was green before deletion.
- New install/auth leave project/Git bytes unchanged. Doctor/review/run leave
  main worktree/index/HEAD/config/non-runtime refs unchanged; only inventoried
  runtime startup recovery is permitted, and run may add runtime-owned Git
  objects/candidate refs/temporary worktree administration.
- Every supported legacy project asset has checked tag/path/hash/mode ownership
  evidence; unknown/user-owned paths are preserved conflicts.
- Immutable release hashing is reproducible and non-circular.
- Locking, activation, ordinary rollback, and crash recovery expose no partial
  executable profile after recovery.
- Malicious project/global OpenCode, Claude, and agent discovery sentinels never
  execute.
- Profile auth remains separate and no credentials or provider secrets appear
  in model tools, prompts, logs, manifests, or diagnostics.
- Provider/model execution is closed to the checked four-provider catalog and
  bundled SDK keys; live/cached catalog refresh, endpoint/npm drift, `file://`,
  `Npm.add`, and package/cache mutation fail before model execution.
- Release-local OpenCode, recorded Codex/Node/Git, canonical `CODEX_HOME`, and
  authorized verification executables retain exact identity; inherited PATH and
  credential bytes never enter the profile/model surface.
- Effective Build capability is exactly `architect_runAuthorizedPipeline` plus
  the three `architect_project*` tools. OpenCode cannot call doctor/review; the bounded launcher
  MCP client receives only one purpose-bound call, and built-in
  read/glob/grep/mutation/process/external tools are denied.
- Gateway protocol, backpressure, limits, bound checkout, future-tool denial,
  and process cleanup pass adversarial tests.
- Installed lifecycle and concurrent isolation pass through the real generated
  launcher/gateway/runtime closure.
- OpenCode produces only pipeline-reviewed `pending-human-decision` candidates;
  `reviewCandidate` is artifact inspection, and OpenCode cannot decide,
  integrate, hand off, or manually apply them.
- Claude Code retains the unchanged complete MCP lifecycle.
- No supported path invokes the retired shell wrapper or falls back to it.
- TypeScript, full tests, generated assets, release validation, plugin
  validation, exact supported-tuple gates, and unsupported-tuple fail-closed
  coverage all pass.
