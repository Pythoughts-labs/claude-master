# Iterative Implementation Increments (Ralph Loop) — Design

Date: 2026-07-18
Status: Proposed — multi-lane design competition + adversarial trust/simplicity review +
advisor consult (`proceed-with-changes`, changes applied below); pending human approval and
an implementation plan.

## Purpose

Extend `delegatePipeline` with a Ralph-style bounded implementation loop: a large task is
implemented by N fresh-context, budget-bounded producer increments that stack commits onto
one candidate **before** any review round, with durable redacted per-increment evidence and
host-computed stall/budget handling. Strictly additive: one optional spec block, one new
writing pipeline role ("implementer") that reuses the fixer's confinement/provenance
machinery, one new report schema, durable per-increment artifacts in the existing
ArtifactStore. Default behavior is byte-identical when the spec block is absent.

The external "Ralph runner" (standalone Python/deepagents script) is a semantics reference
only; the integration is TypeScript inside the existing runtime, MCP surface, and
`skills/delegate` skill. Its five trusted gates and file layout map onto existing
claude-architect machinery (mapping table below).

Canonical schema location is `runtime/schemas/` (imported by `src/protocol/schema-loader.ts:2-6`,
bundled by `npm run build`). AGENTS.md's "schemas/" wording is stale and is corrected with
this change; there is no top-level `schemas/` directory.

## Delivery phasing

- **Phase 0 (prerequisite; its own commit with its own tests, landed before any Phase 1
  code):** close pre-existing recovery gaps the loop would amplify:
  - Add suffix-style `${runId}-pipeline` and `${runId}-verify` to `recoverStaleRuns`'
    managed worktree removal list (recovery-manager.ts:515-525 currently lists only
    prefix-style names) — today's recovery already orphans these; this is a live bug fix
    independent of the feature.
  - Wrap writer-role invocations (fixer today; implementer in Phase 1) in the parent-death
    watchdog used by the attempt producer (attempt-runtime.ts:705-718) and rewrite
    `run-start.json` pid/processToken before each role spawn (export/share the
    `writeRunStart` non-create path, attempt-runtime.ts:295-321), so a host crash mid-round
    never orphans a writing producer that nothing can reclaim.
- **Phase 1 (this design's core):** verified-seed increment loop. Seed is a normal
  `verified-candidate` attempt; increments extend it before review.
- **Phase 2 (follow-up; separate security-focused review):** partial-candidate seeding
  (`failed`/`verification-failure` attempts with a frozen candidate) plus the status-upgrade
  promotion, behind a dedicated `ArtifactStore.promoteVerifiedUpgrade` API. ~40% of the
  total trust surface and test plan lives here; it must not gate Phase 1.

## Goals

- N fresh-context, budget-bounded implementation increments stacking commits onto one
  candidate before review.
- Durable, redacted, write-once per-increment evidence (Ralph's PROGRESS/NEXT_ACTION
  analogs).
- Host-computed stall detection and budget exhaustion that always route to full review +
  clean-room verification + (if not cleanly complete) a forced human decision.
- Default behavior byte-identical when the spec block is absent; zero changes to review,
  consolidation, promotion, clean-room verification, decision, integration, or recovery
  semantics.

## Non-goals

- No new MCP tool, no protocol bump, no new state store, no pipeline resume mid-run.
- No per-increment host verification as the loop-exit signal (see Rejected alternatives).
- No auto-acceptance of anything: all four loop outcomes flow into the unchanged review +
  verification + human-decision machinery.

## Spec & schema changes (public contract)

### `runtime/schemas/delegation-spec.v1.json`

Add one optional property, sibling of `review` (root `additionalProperties:false` currently
rejects it):

```json
"implementation": {
  "type": "object",
  "additionalProperties": false,
  "required": ["maxIncrements"],
  "properties": {
    "maxIncrements": { "type": "integer", "minimum": 1, "maximum": 8 }
  }
}
```

`maxIncrements` counts TOTAL implementation increments including the initial attempt (Ralph
`--iterations`). Absent block ⇒ 1 ⇒ today's single-shot behavior. No `incrementTimeoutMs`,
no `stallThreshold` — each increment reuses `spec.timeoutMs` exactly as fixer invocations do
(role-runner.ts:261), and stall policy is a host constant (one strike). Ship exactly one
field.

### `src/protocol/delegation-spec.ts`

Mirror the ReviewConfig pattern (lines 18-27, 45-47):

```ts
export interface ImplementationConfig { maxIncrements: number; }
export const DEFAULT_IMPLEMENTATION_CONFIG: ImplementationConfig = { maxIncrements: 1 };
export function resolveImplementationConfig(spec: DelegationSpec): ImplementationConfig {
  return spec.implementation ?? DEFAULT_IMPLEMENTATION_CONFIG;
}
```

`DelegationSpec` gains `implementation?: ImplementationConfig` next to `review?`.

### New `runtime/schemas/increment-report.v1.json`

Modeled on fix-report.v1.json; `additionalProperties:false`:

- `reportVersion`: const "1"
- `candidateCommit`: `^(?:[0-9a-f]{40}|[0-9a-f]{64})$`
- `status`: enum `complete | continue | blocked`
- `summary`: string 1..4000 (required)
- `nextSteps?`, `blockers?`: string ≤4000

### Wiring & versioning

- `schema-loader.ts`: compile `incrementReport` into `CompiledSchemas`.
- `report-types.ts`: `IncrementReport` interface.
- `spec-validator.ts`: no change (Ajv covers the shape; no cross-field rules).
- `PROTOCOL_VERSION` stays **1.1.0**, `DELEGATION_SPEC_VERSION` stays "1" — additive
  optional block, exact precedent of the `review` block (see Recorded decisions).
- `npm run build` regenerates `runtime/server.mjs` (schemas are build-inlined; forgetting
  the rebuild is caught by the reproducibility test and release validation).
- Fix AGENTS.md "Sources of truth" wording: schemas live in `runtime/schemas/`.

## Pipeline & runtime changes (file:line insertion points)

### `src/pipeline/role-prompts.ts`

- Line 6: `PipelineRole` gains `"implementer"`.
- Lines 8-15: `RolePackage` gains `progress?: string`. **`commonSections()` (lines 88-102)
  is NOT modified** — add a comment above it stating this is a load-bearing
  prompt-isolation firewall: reviewer/fixer/verifier prompts must never contain implementer
  progress or loop state (pinned by a contract test).
- `const INCREMENT_SCHEMA = readSchemaText("increment-report.v1.json")` near lines 35-37.
- `renderRolePrompt` gains `case "implementer":` composing: untrusted-implementer framing
  (continue toward the objective, edit only within the allowlist, commit with git, do not
  final-verify, do not delegate), `commonSections(pkg)`, a `## Progress notes from prior
  increment` section = `untrustedBlock("progress-notes", pkg.progress ?? "(none)")`, status
  discipline (claim `complete` only when every success criterion is met and verification
  passes locally; never delete/weaken/skip tests), and the fenced INCREMENT_SCHEMA output
  contract.
- Reviewer prompts gain one sentence: the host-supplied diff and the on-disk file tree are
  the authoritative review artifacts; the worktree HEAD may not be resolvable through git
  commands (see Recorded decisions — reviewer git visibility).
- `buildRoleSpec` (163-173): `readOnly = role !== "fixer" && role !== "implementer"`; strip
  both loop knobs from producer-facing specs:
  `const { review: _r, implementation: _i, ...rest } = base;`. Implementer role specs keep
  the base `writeAllowlist`/`forbiddenScope` — identical scope enforcement to the fixer.

### `src/pipeline/role-runner.ts`

- `READ_ONLY_ROLES` (52-56) unchanged.
- Line 152: replace `const fixer = args.role === "fixer"` with a writer predicate
  `const writer = args.role === "fixer" || args.role === "implementer"` used at 155
  (git-object isolation via `resolveLinkedWorktreeWritableRoots`), 174-185 (fail-closed
  `sandbox-violation` when no seatbelt/producer-native write backend — never a
  less-isolated fallback), 229-238 (`buildWriteSeatbeltPolicy`), 244-250
  (`GIT_OBJECT_DIRECTORY`/alternates env). Everything else is inherited: private-object-dir
  commits, sanitized env (nested delegation denied via `CLAUDE_ARCHITECT_DELEGATED`), fresh
  secure tempHome per invocation (208), 2-attempt process retry (203), 1 MB output cap,
  redacted archival — plus the Phase-0 watchdog/pid recording.

### `src/pipeline/pipeline-runtime.ts`

- **Shared structured-role helper:** extract one parameterized
  `runStructuredRole({ role, schemaValidator, logPrefix, pkg, worktreePath, gitObjectAccess, ... })`
  implementing run + parse-with-one-schema-repair + redacted archival, used by `runFix`
  (364-418) and the new `runIncrement` (and, where practical, `runReviews`' inlined copy) —
  the feature must be a net simplification, not a third clone.
- **Provenance factoring:** factor `validateCandidateProvenance` from
  `validateFixProvenance` (431-467): (a) reported commit exists (`cat-file -e`, private
  objects), (b) equals worktree HEAD, (c) previous candidate is an ancestor, and
  **(d) NEW: worktree cleanliness — `git status --porcelain --untracked-files=all` in the
  pipeline worktree must be empty; non-empty ⇒ fail closed (`sandbox-violation`)**. This
  closes the hidden inter-increment state channel and keeps uncommitted implementer files
  away from round-1 reviewers (whose cwd is that worktree). `validateFixProvenance` calls
  it and keeps only its disposition-lineage loop — fix rounds get the cleanliness gate too.
- **Private-object plumbing (advisor-required):** every host git invocation introduced by
  the loop — the cleanliness-gate `git status`, tree-OID progress resolution, and all
  `validateCandidateProvenance` internals — runs with
  `privateObjectReadOptions(gitObjectAccess)`. After increments, the worktree HEAD and all
  increment commits exist only in the fixer-lane private object directory (previously a
  round≥2-only situation, now the common round-1 case); a dedicated test exercises each
  check against an increment commit that exists only in the private object dir.
- **Types:** `PipelineIncrement { increment: number; report: IncrementReport; roleLogRefs: string[] }`
  (increment ordinals start at 2; the initial attempt is increment 1). `PipelineResult`
  (57-66) gains `increments: PipelineIncrement[]` (always present, `[]` when the loop did
  not run). **Redaction:** build `PipelineIncrement.report` from `redactRecord(parsedReport)`
  at parse time so PipelineResult — and therefore MCP `structuredContent` AND the
  JSON.stringify'd text content — never carries unredacted producer free text. (The
  pre-existing equivalent gap in `rounds[]` is recorded for separate repair, not extended.)
- **Phase 1 gate (629-636 unchanged in effect):** attempt must be `verified-candidate` with
  a candidate; otherwise `failedResult` exactly as today. (Phase 2 relaxes this — below.)
- **Increment loop** inserted after worktree creation (line 648), before the round loop
  (652). Runs when `maxIncrements > 1` (a verified seed does not prove the objective is
  complete — later-milestone tests may not exist yet):

  1. Establish `gitObjectAccess` for the pipeline worktree; failure ⇒ `failedResult` with
     `sandbox-violation` (never a less-isolated fallback).
  2. For `increment = 2..maxIncrements`: build `RolePackage` with the cumulative
     `baselineCommit..currentCandidateCommit` diff (private-object read options), frozen
     `testEvidence(attempt)`, and `progress = composeProgressNotes(previous)`.
  3. `runIncrement(...)` via the shared helper: role `implementer`,
     `schemas.incrementReport`, logs `role-implementer-increment<n>`(+`-repair`). Invalid
     output after the single repair ⇒ `failedResult` with the role's failure classification
     and `failedRoleLogRef`.
  4. Archive `pipeline/increment-<n>.json` (write-once, already-redacted record).
  5. `validateCandidateProvenance` (exists / HEAD / ancestry / **clean worktree**);
     violation ⇒ `failedResult` with `producer-failure` or `sandbox-violation`.
  6. **Progress detection by tree OID:** resolve `candidateCommit^{tree}` for the reported
     and previous commits; `progressed = treeOid changed`. `git commit --allow-empty`
     cannot fake progress.
  7. Advance `currentCandidateCommit`; push the increment record.
  8. Exit: `complete` claim → outcome `complete`, break; `blocked` claim → `blocked`,
     break; `continue` with unchanged tree → `stalled` (one strike), break; loop end →
     `budget-exhausted`.

- `composeProgressNotes(previous)` (previous report only, no history accumulator):
  host-deterministic rendering of the PREVIOUS increment's `summary` + `nextSteps` (for
  increment 2: the attempt's `producerSummary ?? summary`), `redact()`-ed,
  marker-neutralized by `untrustedBlock` at render, capped at 8,000 chars. It reaches ONLY
  the implementer prompt.
- **Downstream phases untouched:** review rounds (652-759) automatically cover the
  cumulative baseline..current diff; consolidation, fix rounds, single end-of-pipeline
  promotion (761-827: canonical commit-tree on baseline, pack-import, anchor CAS with
  expected-old = frozen attempt commit — still exactly one promotion per run), clean-room
  `verifyCandidate` (507-620), worktree cleanup (831-841).
- `evaluateGates` call gains `incrementOutcome` (omitted when `maxIncrements === 1`);
  `result` gains `increments`.

### `src/pipeline/gates.ts`

`GateInput` gains `incrementOutcome?: "complete" | "budget-exhausted" | "stalled" | "blocked"`.
Before the return at line 70:

```ts
if (input.incrementOutcome !== undefined && input.incrementOutcome !== "complete") {
  reasons.push(`implementation increments ended ${input.incrementOutcome} without a completion claim`);
  requiresHumanDecision = true;
}
```

Absent field ⇒ zero behavior change for every existing caller and test. Strictly
restrictive: the gate can only ADD human-decision routes. All existing gates apply to
increment runs unchanged.

### Phase 2: partial seeding + status upgrade (follow-up change)

- Relax the hard gate: `partialSeed = maxIncrements > 1 && attempt.status === "failed" &&
  attempt.failure === "verification-failure" && attempt.candidate !== null`. Sound because
  attempt-runtime freezes the candidate BEFORE in-attempt verification (751-772) and
  `verification-failure` is the only post-freeze failure signal — a scope-checked frozen
  partial. Timeout/producer-failure/sandbox-violation never reach freeze and stay hard
  failures.
- **`ArtifactStore.promoteVerifiedUpgrade(...)`:** the failed→verified-candidate flip moves
  behind one dedicated, tested runtime API — never inline pipeline coordination code. The
  method itself enforces ALL preconditions: clean-room verification pass, no baseline
  drift, `testsDeleted === 0 && testsSkipped === 0` (strict; upgrade never rides on
  weakened tests), and no decision recorded. It preserves the pre-upgrade
  `status`/`failure` in `result.evidence.priorOutcome` so the partial-seed history survives
  the replace, then performs the sanitized, schema-verified `promoteTerminalArtifacts`
  replace. Race-free: `runPipeline` and `decideCandidate` hold the same `withRepoLock` key.
- If verification fails or drifts: no upgrade; archived result stays
  `failed`/`verification-failure`; `decideCandidate accepted` refuses
  (`requireVerifiedCandidate`), `integrateCandidate` refuses, `reviewCandidate` still
  exposes the exact partial patch — fail closed with no new code.
- Dedicated adversarial test: a false producer `complete` claim can never produce
  `decision-ready` where today's single-shot pipeline would not.

## Durable artifact model

All under the trusted state root (`CLAUDE_PLUGIN_DATA`, outside the repo;
producer-unwritable under seatbelt but producer-READABLE — hence every write is redacted at
the primitive):

| Artifact | Writer / primitive | Lifecycle |
|---|---|---|
| `pipeline/increment-<n>.json` (n≥2) | `writePipelineArtifact`: redactRecord + write-once fsync/hardlink | Written immediately after each increment's report parses; monotonic names; survives crash |
| `logs/role-implementer-increment<n>.log` (+`-repair`) | `runArchivedRole` → `writeLog` (redacted, 1 MB cap) | Raw producer output per invocation |
| `pipeline/pipeline-result.json` | existing terminal write; now includes `increments[]` + incrementOutcome gate reason | Terminal pipeline evidence |
| `result.json` / `manifest.json` | attempt archive (unchanged); Phase 2: guarded `promoteVerifiedUpgrade` replace | Write-once then guarded atomic replace |
| candidate anchor `refs/claude-architect/candidates/<runId>` | freezeCandidate once; single end-of-pipeline CAS | UNCHANGED single-anchor model; recovery's exact-OID deletion and prune journal need zero changes |
| `run-start.json` | Phase 0: rewritten with current role-producer pid/token before each writer spawn | Recovery can always kill the right tree |

Increment commits live in the linked worktree's private object dir until promotion imports
the canonical commit; intermediate commits are disposable evidence (the cumulative diff is
the reviewed artifact). Documented posture: the seatbelt read profile is allow-default, so
producers can read redacted run artifacts from disk; a state-dir read denial is a recorded
hardening option, not part of this change.

## Increment loop semantics summary

- **Freshness:** every increment is a brand-new producer process with a fresh secure
  tempHome and sanitized environment; no session reuse; context = spec + cumulative diff +
  one bounded, redacted, untrusted-fenced previous-increment note. The per-run pipeline
  worktree is shared exactly as fix rounds share it; inter-increment state carries
  EXCLUSIVELY through git commits, now enforced by the post-increment cleanliness gate.
- **Freeze:** increment work becomes real only as commits validated by
  `validateCandidateProvenance` (exists / HEAD / ancestry / clean tree); durable freeze =
  the attempt freeze + the single end-of-pipeline promotion CAS.
- **Exit:** `complete` | `blocked` | stalled (one no-progress strike, tree-OID) |
  budget-exhausted → ALWAYS into full review + clean-room verification. Claims are
  untrusted and control ONLY budget spending, never acceptance.
- **Budgets:** `maxIncrements ≤ 8`; per increment: `spec.timeoutMs` wall clock, 2 process
  attempts, 1 schema-repair retry, 1 MB output; review budgets unchanged (`maxRounds ≤ 2`).

## Crash recovery

- **Crash during the initial attempt:** unchanged (run-start pid/token, watchdog,
  `recoverStaleRuns` kills tree, removes worktrees, deletes anchor exactly-by-OID, archives
  cancelled terminal result).
- **Crash during increments or rounds:** the attempt already archived a valid terminal
  `result.json`, so startup recovery treats the run as terminal (no destructive
  re-recovery). With Phase 0 in place, the current writer-role pid is recorded and the
  `${runId}-pipeline` worktree is in the removal list, so nothing is orphaned. Durable
  evidence at crash time: attempt result/manifest, every completed `increment-<n>.json`,
  all role logs, any round artifacts. The anchor still points at the attempt's frozen
  commit (promotion is a single end-of-pipeline CAS), so no ref can dangle at an
  unreachable increment commit. No pipeline resume in v1: recovery = the architect
  re-delegates a fresh spec, optionally informing its `context` from archived increment
  evidence via the normal human-mediated path.
- **Phase 2 crash between promotion and status upgrade:** archived result reflects the
  promoted candidate with pre-upgrade status; anchor and manifest hash consistent;
  acceptance stays refused until a future run verifies — fail closed.
- **Retention:** increment artifacts are bounded per-file (4,000-char report fields, 1 MB
  logs) and counted by prune's `directoryBytes`; the unwired-prune growth issue is
  inherited and flagged, not structurally expanded.

## Gates & statuses

- Statuses unchanged: `decision-ready | human-decision-required | failed`.
- Existing gates unchanged and fully applicable: missing/failed clean-room verification,
  deleted/skipped tests, dirty verify worktree, out-of-scope diff, undispositioned or
  unresolved blocker/major findings, fixed-without-commit, final-fix-not-re-reviewed, round
  cap, baseline drift, invalid artifacts.
- New: non-`complete` `incrementOutcome` forces `human-decision-required` even when reviews
  and verification pass — `successCriteria` can exceed the mechanical verification
  commands, matching the existing round-cap gate philosophy.

## MCP + SKILL.md changes

- **No new MCP tool.** Input schemas unchanged (spec rides as `z.unknown`). One additive
  zod line: `delegatePipelineOutput.result` gains
  `increments: z.array(z.record(z.string(), z.unknown())).optional()` (default zod objects
  strip unknown keys from `structuredContent`). Handshake tool roster unchanged; no new
  permission approvals. `handleDelegatePipeline` unchanged.
- **skills/delegate/SKILL.md:** (1) Choosing delegate vs delegatePipeline: large
  multi-milestone tasks should set `implementation.maxIncrements` instead of failing one
  oversized attempt. (2) Pipeline lifecycle yaml gains
  `implementation: { maxIncrements: 4 }  # optional; default 1`. (3) Lifecycle prose:
  fresh-context increments, archived `pipeline/increment-N.json` as untrusted producer
  notes (never evidence), increment-outcome gate reasons. (4) **Cost path:** a
  blocked/stalled/budget-exhausted loop still runs full review rounds and up to `maxRounds`
  fix rounds before the human decision; worst-case wall clock ≈
  `(maxIncrements + 3 × maxRounds) × timeoutMs` with no whole-lifecycle deadline — budget
  accordingly. (5) Plain `delegate` accepts and ignores the block. (6) Minimum plugin
  version for the block (older runtimes reject it fail-closed). PROTOCOL marker unchanged
  at 1.1.0; the SKILL-contract tests pinned by the delegation-contract-repair plan are
  updated in the same change.
- Docs: README, docs/ARCHITECTURE.md (pipeline phase list), CHANGELOG Unreleased; AGENTS.md
  schemas-location fix.

## Ralph → claude-architect mapping

| Ralph artifact / gate | claude-architect equivalent |
|---|---|
| TASK / ACCEPTANCE_CRITERIA / CONSTRAINTS | DelegationSpec (objective+context / successCriteria / writeAllowlist+forbiddenScope+verification), archived in the run manifest |
| STATE.json | `result.json` + `pipeline-result.json` (increments[], rounds[], gate) — schema-validated, hash-sealed |
| PROGRESS.md | `pipeline/increment-<n>.json` summaries + role logs |
| NEXT_ACTION.md | `increment-<n>.json.nextSteps` → next increment's bounded untrusted progress note |
| IMPLEMENTATION.md | exact candidate patch regenerated from anchored OIDs by `reviewCandidate` |
| CANDIDATE.json | CandidateArtifact (OIDs, anchorRef, manifestHash, changedPaths) |
| REVIEW.md | `round-N-review-*.json` + `round-N-consolidated.json` |
| VERIFICATION.md | `pipeline/verification.json` + acceptance-verifier logs (argv arrays, shell-free) |
| DECISIONS.md / DONE.md | `decision.json` (human-only) + integrate record — writable only by the trusted runtime under repo lock |
| BLOCKERS.md | `increment-<n>.json.blockers` + `unresolvedIssues` + gate reasons |
| invocations/inv-*/ + FRESHNESS | `logs/role-*.log`, manifest env provenance, fresh tempHome per invocation, run-start.json |
| Gate 1 candidate frozen | freezeCandidate + anchor + provenance-validated promotion |
| Gate 2 review passed | evaluateGates finding/disposition checks |
| Gate 3 verification passed | clean-room verifyCandidate pass |
| Gate 4 tree clean | `workspaceClean` gate + NEW per-increment cleanliness gate |
| Gate 5 human APPROVE | decideCandidate accepted (`requireVerifiedCandidate`) + integrate expected-old-head guard |
| `--iterations` | `implementation.maxIncrements` |
| `--fix-iterations` / `--review-rounds` | existing `review.maxRounds` |
| `--allow` / `--verify-command` | `writeAllowlist` / `verification[]` |
| `--non-interactive` stop | decision-ready / human-decision-required; never auto-accepts |
| refuses merges/pushes | anchor refs only; integration stages, never commits |

## Trust invariant preservation (all 10)

1. **Fresh context + fresh isolated worktree per attempt.** Initial attempt unchanged. Each
   increment is a new producer process with fresh tempHome and sanitized env; context =
   spec + cumulative diff + one fenced durable note. Increments share the per-run pipeline
   worktree exactly as fix rounds do; the cleanliness gate guarantees inter-increment state
   carries exclusively through git commits — the defined semantics of an increment, not
   hidden state.
2. **Implementers cannot review/approve/accept.** The IncrementReport claim controls only
   loop budget; review is separate fresh processes; acceptance requires human
   `decideCandidate`.
3. **Reviewers see frozen bytes without implementer context.** Reviews run after ALL
   increments over committed baseline..candidate; `commonSections()` is unmodified so
   reviewer/fixer/verifier prompts structurally cannot contain progress notes (comment +
   contract test pin it); the cleanliness gate keeps uncommitted implementer files out of
   the reviewer worktree.
4. **Read-only roles cannot mutate.** `READ_ONLY_ROLES` unchanged; the implementer is a
   writing role inheriting the fixer's fail-closed confinement verbatim (no backend ⇒
   sandbox-violation, never a fallback; commits only in the private object dir).
5. **Versioned durable artifacts, no hidden state.** Inter-increment communication = git
   commits + schema-validated write-once redacted reports; progress notes are
   host-recomposed from archived reports; no session reuse.
6. **Objective, recorded, rerunnable verification; claims never evidence.** Increment
   claims never enter `evaluateGates`; only host-run clean-room verification and reviewer
   reports feed gates; Phase 2 upgrade fires only on clean-room pass over the exact final
   commit and preserves the pre-upgrade outcome in evidence.
7. **Only the human accepts.** decideCandidate/integrateCandidate untouched; the new gate
   field is strictly restrictive — it can only add human-decision routes.
8. **Durable across process failure.** Every increment report archived write-once before
   the loop continues; attempt terminal artifacts durable before any increment; Phase 0 pid
   recording + worktree-list fix mean a crash orphans nothing; single-anchor recovery
   unchanged.
9. **Final review covers the whole branch.** Structural: increments complete BEFORE round
   1, and every round + clean-room verification span the cumulative baseline..current
   range; the `finalRoundReviewed` gate still guarantees no unreviewed final write.
10. **Quality/simplicity over cost.** One role reusing proven machinery, one additive
    block, one report schema, a shared helper that net-simplifies pipeline-runtime, no new
    store/tool/status/version; default byte-identical; the riskiest path staged behind its
    own review.

## Recorded decisions

- **Producer-commit vs host-freeze increments:** keep producer commits under the fixer
  lane. Host freeze per increment is a smaller producer surface in theory, but it drags in
  freezeCandidate CAS changes, per-increment full verification cost, a loop-state machine,
  and a startup-recovery redesign whose adversarially reviewed draft was fail-open. The
  fixer lane plus the cleanliness gate achieves the same invariants with machinery that
  already survived review.
- **Shared per-run pipeline worktree vs fresh worktree per increment:** keep the shared
  worktree (fix-round precedent), hardened by the mandatory empty
  `git status --porcelain --untracked-files=all` gate after every writer invocation.
- **PROTOCOL_VERSION stays 1.1.0:** a bump to 1.2.0 would hard-fail every stale
  skill/runtime pairing via the exact-equality handshake, including users who never touch
  the feature; staying at 1.1.0 means only specs carrying `implementation` fail on old
  runtimes, fail-closed, with an explicit invalid-specification diagnostic.
- **Reviewer git visibility after increments (advisor-required, explicit):** reviewers are
  pinned to the host-supplied diff and the on-disk file tree as the authoritative review
  artifacts — stated in the reviewer prompt, documented by a comment, and enforced by a
  contract test that reviewer invocations receive no `gitObjectAccess`
  (pipeline-runtime.ts:319-326 roleArgs omits it today). This matches the existing round≥2
  post-fix situation. Passing a read-only `GIT_ALTERNATE_OBJECT_DIRECTORIES` env to
  reviewer invocations is recorded as a follow-up option, not part of this change.
- **Wall-clock policy (advisor-required, accepted bound):** cancellation responsiveness is
  per-invocation via the abortSignal (role-runner.ts:254); a whole-pipeline deadline is
  deferred. The repo-lock hold-time ceiling
  `(maxIncrements + 3 × maxRounds) × timeoutMs` is an accepted, documented bound, stated in
  SKILL.md; whether to add a pipeline deadline is an open question the human owns.
- **Per-increment host verification as loop exit:** rejected — multiplies full-suite
  executions per pipeline; the untrusted complete/continue claim controls only budget and
  is fully backstopped by mandatory review + clean-room verification + the restrictive
  incrementOutcome gate.

## Testing plan

**Unit**
- Spec validation: absent block accepted; `{maxIncrements:4}` accepted; unknown keys, 0, 9,
  non-integers rejected; resolver default.
- gates: `incrementOutcome` absent ⇒ identical GateResult on existing fixtures; `complete`
  ⇒ no reason; each non-complete value ⇒ reason + `requiresHumanDecision` even with passing
  verification and empty findings.
- `composeProgressNotes`: previous-report-only; 8,000-char cap; registered secret absent
  (redaction); deterministic.
- `validateCandidateProvenance` factoring: existing `validateFixProvenance` tests pass
  unchanged; NEW cleanliness branch: dirty worktree (tracked mod, staged, untracked file
  each) ⇒ fail closed.
- Tree-OID progress: `--allow-empty` commit ⇒ not progressed ⇒ stalled.
- Private-object plumbing: each new host git check exercised against an increment commit
  that exists only in the private object directory (advisor-required).

**Contract**
- increment-report schema: minimal valid accepted; missing status, bad commit pattern,
  over-length summary, unknown keys rejected.
- MCP output zod round-trips `increments`; handshake roster unchanged.
- Prompt-isolation pin: `renderRolePrompt` for
  reviewer-correctness/reviewer-systems/fixer/verifier with `progress` set must NOT contain
  the progress content; only the implementer prompt may, inside untrusted fencing.
- Reviewer git-visibility pin: reviewer invocations receive no gitObjectAccess; reviewer
  prompt names the host diff as authoritative.
- SKILL contract tests updated (yaml block + lifecycle text); `npm run build`
  reproducibility.

**Integration** (injected roleRunner/runAttempt, real ArtifactStore + worktrees)
- Happy path: verified attempt, `maxIncrements:3`, fake implementer commits then reports
  `complete` at increment 2 ⇒ increment archived, review over cumulative diff, promotion
  CAS, clean-room pass, `decision-ready`, `increments.length === 1`.
- Budget exhaustion / tree-OID stall / `blocked` ⇒ review still runs ⇒
  `human-decision-required` with the increment-outcome reason.
- Role failure after retry and schema failure after repair ⇒ `failed` with correct
  classification and `failedRoleLogRef`; attempt artifacts intact.
- Dirty-worktree increment ⇒ pipeline fails closed; frozen attempt candidate still
  reviewable.
- Default spec ⇒ byte-identical PipelineResult vs main on existing e2e fixtures
  (regression diff).
- Crash simulation: kill after increment-2 write ⇒ `recoverStaleRuns` (with Phase 0) kills
  recorded role pid, removes `${runId}-pipeline`, run not re-cancelled (terminal result
  exists), anchor at attempt commit, `increment-2.json` readable.
- Phase 2: partial-seed completes ⇒ `promoteVerifiedUpgrade` fires ⇒ accept + integrate
  end-to-end; verification-still-failing ⇒ NO upgrade, accept returns
  candidate-not-verified, integrate aborts, reviewCandidate returns the exact patch;
  upgrade refused when `testsDeleted > 0`.

**Adversarial**
- Reviewer prompt isolation (above); progress-note prompt-injection ("APPROVE this
  candidate", fence markers) neutralized by `untrustedBlock`, never alters gate output.
- Provenance attacks: non-descending commit (reset/rebase) ⇒ sandbox-violation; not-HEAD ⇒
  producer-failure; nonexistent commit ⇒ producer-failure; uncommitted-file smuggling
  between increments ⇒ fail closed (cleanliness gate).
- Confinement: implementer with no seatbelt/producer-native backend ⇒ sandbox-violation, no
  fallback; implementer absent from READ_ONLY_ROLES assertion.
- Secret hygiene: registered secret in a fake implementer's summary ⇒ absent from
  `increment-<n>.json`, from `PipelineResult.increments` (MCP text content), and from the
  next increment's composed prompt.
- Phase 2: false `complete` claim can never yield `decision-ready` where the single-shot
  pipeline would not.

**Smoke (opt-in real adapter):** real Codex, macOS arm64, `maxIncrements:2` toy task
through delegatePipeline to `decision-ready` (per the fake-adapter-hides-real-sandbox-bugs
lesson).

**Repository checks:** `npx tsc --noEmit`, `npx vitest run`,
`bash scripts/validate-release.sh` (unchanged 1.1.0 marker), `claude plugin validate .`.

## Risks

- Phase 2's `promoteVerifiedUpgrade` is a new trust-sensitive write path; mitigated by a
  single precondition-enforcing store API, strict tests-not-weakened condition, preserved
  pre-upgrade outcome, integrate-time hash/anchor revalidation, and staging behind its own
  security review.
- Repo-lock hold time: the accepted `(maxIncrements + 3 × maxRounds) × timeoutMs` ceiling
  blocks decide/integrate/review for other runs on the repo while held (see Recorded
  decisions — wall-clock policy).
- Writer lane availability: increments require macOS seatbelt or a producer-native write
  sandbox — effectively macOS/Codex-scoped today; elsewhere fails closed to
  sandbox-violation (documented).
- Frozen `testEvidence(attempt)` shows increment-1 outcomes to reviewers; untrusted-fenced
  and superseded by clean-room verification; prompt text names clean-room as authoritative.
- `additionalProperties:false` one-way compatibility: old runtimes reject specs carrying
  the block (fail-closed diagnostic); SKILL documents the minimum version.
- Retention unwired: per-increment artifacts accelerate runs/ growth (per-file bounded).
- State dir is producer-readable (allow-default read profile): redaction-at-write is the
  defense; read-denial is a recorded hardening option.
- Adversarial producers can burn the full budget with plausible `continue` reports plus
  real commits; cost is bounded budget waste plus one forced human decision, never
  acceptance.
- One-strike stall may end loops where a producer legitimately spent an increment
  analyzing; the human-decision route recovers it; revisit after dogfooding.

## Rejected alternatives

- **Host-freeze increments in fresh per-increment worktrees with per-increment CAS anchor
  advance:** a genuinely smaller producer surface (no commit rights), but it requires
  freezeCandidate API changes, per-increment full host verification cost, a mutable
  loop-state phase machine, and a startup-recovery predicate redesign whose adversarial
  review found a critical fail-open (live runs cancellable by concurrent server startup)
  plus archive/anchor desync on routine failure exits.
- **New MCP tool (delegateLoop) with milestone ladder and separate loop store:** cannot
  stack increments inside one candidate (runAttempt bases on checkout HEAD under a clean
  tree), so it requires a human accept→integrate→commit per milestone — today's flow with a
  large new state surface; judged unsound on simplicity. Its digest-firewall test and
  prompt-isolation comment are grafted instead.
- **PROTOCOL_VERSION bump to 1.2.0** — see Recorded decisions.
- **Looping full runAttempt per increment:** base derives from checkout HEAD, so repeated
  calls produce sibling candidates, not stacked increments; each mints a new
  runId/anchor/lock cycle.
- **Multi-increment logic inside attempt-runtime.ts:** the attempt runtime is deliberately
  single-shot (one run-start, one freeze, one terminal archive); a loop there entangles
  crash recovery and the terminal manifest model.
- **Modeling increments as extra review rounds / fixer reuse with synthetic findings:**
  conflates implementation and review budgets, distorts finalRoundReviewed/round-cap
  semantics, forces a 2-reviewer pass between increments, and overloads FixReport with
  foreign meaning.
- **Per-increment candidate anchor refs:** breaks the single-anchor assumption hard-coded
  across the store, recovery, and prune journal for evidence the durable increment reports
  already provide.
- **Mutable Ralph-style STATE.json/NEXT_ACTION.md files:** mutable trusted state
  reintroduces the tamper/recovery ambiguity write-once numbered artifacts were designed to
  avoid.
- **Seeding from any failed attempt:** only verification-failure-with-candidate is a
  well-defined scope-checked frozen partial (freeze precedes verify); other failures never
  reach freeze.
- **stallThreshold / incrementTimeoutMs spec knobs:** tuning surface nobody asked for; host
  constant (one strike) and `spec.timeoutMs` give identical behavior with less versioned
  schema.
- **Adopting the Ralph runner's Python/deepagents implementation directly:** a parallel
  orchestrator outside the trusted runtime would duplicate worktree isolation, confinement,
  artifact durability, and decision binding without their tests; only its loop semantics
  are adopted.

## Open questions (human-owned)

1. Phase 2 go/no-go: is the partial-seed + failed→verified-candidate upgrade path worth its
   trust surface at all, or is the verified-seed increment loop sufficient long-term?
2. Wall-clock: accept the documented repo-lock ceiling, or add a whole-pipeline deadline (a
   behavior change for existing runs), and at what budget?
3. State-dir read confinement: accept the current documented posture, or invest in a
   state-dir read-denial for role sandboxes (risks breaking Codex's native sandbox init)?
4. Retention: when should wiring `ArtifactStore.prune` into production be prioritized
   relative to this feature?
