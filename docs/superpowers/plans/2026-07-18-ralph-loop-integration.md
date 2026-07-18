# Ralph Loop Integration — Implementation Plan

> **For agentic workers:** Implement task-by-task; every task is one bounded delegation
> unit through the MCP delegate lifecycle (delegatePipeline by default), integrated and
> verified before the next task starts. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `implementation: { maxIncrements }` block to the Delegation Spec
that makes `delegatePipeline` run N fresh-context implementation increments — stacking
commits onto one candidate before review — with durable redacted per-increment evidence,
tree-OID stall detection, a per-writer worktree cleanliness gate, and a restrictive
`incrementOutcome` gate. Default behavior (block absent) is byte-identical to today.

**Architecture:** Strictly additive on `src/pipeline/`: a new `implementer` writing role
reuses the fixer's confinement/provenance/promotion machinery (writer predicate in
role-runner); the increment loop sits between worktree creation and the round loop in
`runPipeline`. No new MCP tool, no protocol bump, no new state store, no new statuses.

**Tech stack:** TypeScript ESM (Node ≥22), ajv JSON-schema validation, zod MCP output
schemas, vitest. `npm run build` regenerates `runtime/server.mjs`, folded into the same
commit as the src change (release validation enforces byte-stable rebuild).

Spec: `docs/superpowers/specs/2026-07-18-ralph-loop-integration-design.md`

## Global constraints

- Every task: failing-first regression test, full `npx vitest run` green, mandatory
  separate `npx tsc --noEmit` gate, `runtime/server.mjs` regenerated in the same commit
  when src changes; never gate on piped vitest output.
- Trust invariants and recorded decisions are fixed by the spec; a task that cannot satisfy
  one stops and reports rather than weakening it.
- `commonSections()` in role-prompts.ts is a prompt-isolation firewall and is never
  modified; reviewer/fixer/verifier prompts must never contain implementer progress.
- Every new host git invocation in the loop runs with
  `privateObjectReadOptions(gitObjectAccess)` (increment commits exist only in the
  fixer-lane private object dir until promotion).
- Fail closed everywhere: no sandbox ⇒ `sandbox-violation`; invalid structured output after
  one repair ⇒ phase failure; dirty writer worktree ⇒ `sandbox-violation`.
- Commit messages: imperative, ≤72-char subject, no co-author trailers or generated-by
  footers. Phase 0 lands as its own commit before any Phase 1 code.
- Phase 2 (partial seeding + `promoteVerifiedUpgrade`) is NOT in this plan — deferred
  pending the human go/no-go recorded in the spec's open questions.

## File structure

New files:

```
runtime/schemas/increment-report.v1.json
tests/runtime/increment-report-schema.test.ts   (or folded into report-schemas.test.ts)
```

Modified files:

```
src/runtime/recovery-manager.ts        # Phase 0: suffix-style worktree removal
src/runtime/attempt-runtime.ts         # Phase 0: share writeRunStart non-create path
src/pipeline/role-runner.ts            # Phase 0: writer watchdog+pid; P1: writer predicate
runtime/schemas/delegation-spec.v1.json  # implementation block
src/protocol/delegation-spec.ts        # ImplementationConfig + resolver
src/protocol/schema-loader.ts          # compile incrementReport
src/pipeline/report-types.ts           # IncrementReport, PipelineIncrement
src/pipeline/role-prompts.ts           # implementer role, progress, firewall comment
src/pipeline/pipeline-runtime.ts       # helper extraction, provenance factoring, loop
src/pipeline/gates.ts                  # incrementOutcome
src/mcp/tools.ts                       # additive zod output line
skills/delegate/SKILL.md               # maxIncrements guidance + cost path
README.md, docs/ARCHITECTURE.md, CHANGELOG.md, AGENTS.md  # docs + schemas-location fix
runtime/server.mjs                     # regenerated per task
tests/runtime/*                        # per-task coverage (see spec Testing plan)
```

---

### Task 1 (Phase 0): recovery reclaims pipeline worktrees and writer roles

- [ ] Add suffix-style `${runId}-pipeline` and `${runId}-verify` to `recoverStaleRuns`'
  managed-worktree removal list (src/runtime/recovery-manager.ts:515-519; names created at
  src/pipeline/pipeline-runtime.ts:646 and :519). Failing-first test: stale run record +
  suffix-style worktrees present ⇒ recovery removes them.
- [ ] Run writer-role (fixer) producer invocations under the parent-death watchdog used by
  the attempt producer (src/runtime/attempt-runtime.ts:705-724, runtime/watchdog.mjs), and
  rewrite `run-start.json` pid/processToken via the shared non-create `writeRunStart` path
  (attempt-runtime.ts:270-341, update pattern at :355) before each writer spawn
  (role-runner.ts:256 currently calls `supervise` bare). Tests: watchdog argv present on
  writer spawns; run-start rewritten before spawn; recovery terminates the recorded role
  pid in a crash simulation.
- [ ] Preserve recovery idempotence semantics (terminal marker, live-lock preservation);
  read-only roles unchanged.
- [ ] Own commit, before any Phase 1 code.

### Task 2: contract layer (no behavior change)

- [ ] `implementation` block in runtime/schemas/delegation-spec.v1.json (exact shape from
  spec; `maxIncrements` integer 1..8, `additionalProperties:false`).
- [ ] `ImplementationConfig`, `DEFAULT_IMPLEMENTATION_CONFIG`, `resolveImplementationConfig`
  in src/protocol/delegation-spec.ts (ReviewConfig pattern).
- [ ] runtime/schemas/increment-report.v1.json (reportVersion "1"; candidateCommit 40/64
  hex; status complete|continue|blocked; summary 1..4000 required; nextSteps?/blockers?
  ≤4000); compile in schema-loader; `IncrementReport` in report-types.
- [ ] Unit/contract tests: spec-validation matrix (absent/valid/0/9/unknown-keys/
  non-integer), resolver default, increment-report schema matrix.

### Task 3: provenance factoring + cleanliness gate

- [ ] Factor `validateCandidateProvenance` (exists via `cat-file -e` / equals worktree HEAD
  / previous-candidate ancestry / NEW empty `git status --porcelain
  --untracked-files=all`) out of `validateFixProvenance`
  (src/pipeline/pipeline-runtime.ts:425-505); fix rounds gain the cleanliness gate.
- [ ] All internals run with `privateObjectReadOptions`; dedicated test runs each check
  against a commit existing only in the private object dir.
- [ ] Tests: existing fix-provenance suite unchanged; dirty-worktree matrix (tracked mod /
  staged / untracked) ⇒ fail closed `sandbox-violation`.

### Task 4: role surface — implementer as a writer role

- [ ] role-prompts.ts: `PipelineRole` + `"implementer"`; `RolePackage.progress?`; firewall
  comment above unmodified `commonSections()`; implementer prompt case (untrusted framing,
  progress via `untrustedBlock`, status discipline, fenced increment schema); reviewer
  prompt sentence naming the host diff + on-disk tree authoritative; `buildRoleSpec`
  writer handling and stripping of `review`/`implementation` from producer-facing specs.
- [ ] role-runner.ts: `writer` predicate (fixer ∨ implementer) at the git-object-isolation,
  fail-closed-backend, seatbelt-policy, and env sites; `READ_ONLY_ROLES` unchanged.
- [ ] Contract tests: prompt-isolation pin (reviewer/fixer/verifier prompts never contain
  progress content); reviewer invocations receive no gitObjectAccess; readOnly matrix
  includes implementer as writer.

### Task 5: increment loop in runPipeline

- [ ] Extract shared `runStructuredRole` helper (run + one schema-repair + redacted
  archival) used by `runFix` and new `runIncrement` — net simplification.
- [ ] Insert increment loop after worktree creation (pipeline-runtime.ts:648): loop
  increments 2..maxIncrements per the spec's 8-step semantics (cumulative diff package,
  archive `pipeline/increment-<n>.json` write-once redacted, provenance+cleanliness,
  tree-OID progress, exit complete/blocked/stalled/budget-exhausted).
- [ ] `composeProgressNotes` (previous report only, redacted, 8k cap, implementer-only).
- [ ] `PipelineIncrement` type; `PipelineResult.increments` (always present, `[]` default);
  `redactRecord` at parse time.
- [ ] Integration tests (fake roleRunner/runAttempt, real store+worktrees): happy path,
  stall, budget exhaustion, blocked, role/schema failure classification, dirty-worktree
  fail-closed.

### Task 6: gates + MCP output + default-behavior pin

- [ ] gates.ts: optional `incrementOutcome` input; non-`complete` ⇒ reason +
  `requiresHumanDecision` (strictly additive).
- [ ] mcp/tools.ts: additive zod line `increments` on `delegatePipelineOutput.result`.
- [ ] Tests: gate matrix (absent ⇒ identical GateResult on existing fixtures); zod
  round-trip; handshake roster unchanged; byte-identical default-spec PipelineResult
  regression against existing e2e fixtures.

### Task 7: adversarial + crash suite

- [ ] Progress-note prompt injection neutralized; secret hygiene (registered secret absent
  from increment artifact, MCP text content, next prompt); provenance attacks
  (reset/rebase, not-HEAD, nonexistent commit, uncommitted-file smuggling); confinement
  (no backend ⇒ sandbox-violation, no fallback).
- [ ] Crash simulation: kill after increment-2 archive ⇒ recovery (with Task 1) reclaims
  pid + `${runId}-pipeline` worktree, run stays terminal, anchor at attempt commit,
  increment artifact readable.

### Task 8: skill + docs

- [ ] SKILL.md: maxIncrements guidance, lifecycle yaml + prose, cost-path warning
  (`(maxIncrements + 3 × maxRounds) × timeoutMs`, no whole-lifecycle deadline), plain
  `delegate` ignores the block, minimum plugin version; SKILL-contract tests updated.
- [ ] README, docs/ARCHITECTURE.md pipeline phase list, CHANGELOG Unreleased entry,
  AGENTS.md schemas-location fix (`runtime/schemas/`).
- [ ] Opt-in real-Codex smoke: `maxIncrements: 2` toy task to `decision-ready`.

### Follow-ups (not in this plan)

- Phase 2 partial seeding + `ArtifactStore.promoteVerifiedUpgrade` (own security review;
  human go/no-go pending).
- Recorded hardening options: state-dir read denial; reviewer read-only alternates env;
  whole-pipeline deadline; prune wiring; pre-existing `rounds[]` redaction gap.
- Release: next minor version bump with all four version surfaces + plugin-wiring pins.
