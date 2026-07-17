# Enhancement Plan: Dynamic Delegation Workflows for Claude Architect

Status: revision 3 (2026-07-16) — incorporates the rev-2 review (9/10, "fix before
implementation"): per-task human approval under the serial head, host-bound decision
evidence, terminal-state classes, atomic fenced integration, and frozen trusted inputs.
Sources: `reference-spec.md` (fresh-context delegation CLI), the
Dynamic Delegation Workflows design (three loops), two independent Codex GPT-5.6 design
reviews of this codebase (`01` run evidence, `02-role-separation.md`), and the
architecture review of revision 1.

## 1. Where the plugin already is

The plugin already implements the **inner task loop** of the dynamic-workflow design:

| Dynamic-workflow concept | Existing mechanism |
| --- | --- |
| Fresh implementer | `src/runtime/attempt-runtime.ts` — per-run worktree, watchdog-supervised fresh process, frozen candidate |
| Parallel fresh reviewers | `src/pipeline/role-runner.ts` + `pipeline-runtime.ts` — correctness + systems via `Promise.all`, fresh temp homes, read-only confinement (`READ_ONLY_ROLES`, empty write allowlist, sandbox-gated) |
| Findings consolidation | `src/pipeline/consolidator.ts` — deterministic dedup, highest-severity-wins, contradiction detection |
| Fresh fixer + re-review | fixer role with original allowlist only, dispositions per finding, re-review rounds bounded by `maxRounds` |
| Independent verification | host-code clean-worktree `verifyCandidate` — scope, baseline ancestry, deleted/skipped-test detection, cleanliness |
| Artifact-only handoff | `ArtifactStore`, `runtime/schemas/*.v1.json`, hash-anchored candidates |
| Human merge gate | `decideCandidate` / `integrateCandidate`; pipeline never merges, never waives |

The plan adds only the orchestration around that loop: the workflow loop (task source →
queue → per-task pipeline → decision → **integration** → rediscovery → objective stop
condition → whole-branch final review), the process-improvement loop, and the
auditability/adjudication hardening the design reviews identified. The trust model is
unchanged: producers stay untrusted, the runtime stays fail-closed, and **a human is the
only acceptance authority** (§2.5).

## 2. Design

### 2.1 Workflow branch and head model (review blocker 1)

Every workflow owns one integration branch and a single serially-advancing head:

```
workflows/<workflowId>          # branch created at workflowBaseline
```

- Each per-task pipeline runs against the **current workflow head**, not the original
  baseline.
- Integration is strictly serial. Before integrating an approved candidate, the
  controller re-checks `candidate.baseCommit == workflowBranch.head()`; on mismatch the
  task is marked `stale` and requeued with a new spec revision against the new head.
- Task discovery, stop-condition commands, and final review all run against the
  integrated head only.

**Invariant:** *a candidate does not affect task discovery, stop commands, or final
review until it is integrated into the workflow branch.* Only `integrated` tasks count
as completed.

### 2.2 Task state model (review blocker 1)

```
pending → in-flight → decision-ready → approved → integrating → integrated
```

Alternative exits:

```
in-flight        → requeued | blocked
decision-ready   → rejected
integrating      → integration-failed
(dynamic sources) → superseded | stale | duplicate
any unresolved   → human-review
```

`integrating` is durable so a crash mid-integration is detected and reconciled on
resume (`reconcileInterruptedAttempts`), never silently double-applied.

**Terminal-state classes (rev-2 review point 3).** Fixed-point completion classifies
every state explicitly:

```
Successful terminal:  integrated;
                      duplicate   (only when linked to an integrated canonical task);
                      superseded  (only when linked to an integrated replacement)
Unsuccessful terminal: rejected, blocked, integration-failed, human-review
Temporary:            pending, in-flight, decision-ready, approved, integrating,
                      requeued, stale
```

A workflow completes only when **every required logical task has a successful terminal
resolution AND no unsuccessful terminal state exists AND stop conditions pass AND final
review and final verification pass**. A human rejection therefore cannot vanish behind a
passing stop command: it must be resolved by cancelling the workflow, revising the
workflow spec (new revision), or requeueing the task with explicit new requirements.

**Integration transaction (rev-2 review point 4).** Git ref movement and state
persistence are separate operations, so integration is a fenced transaction:

```
1. Persist integration intent: expectedOldHead, candidateCommit, expectedNewTree,
   integrationOperationId
2. Atomic ref update: git update-ref <workflow-ref> <new> <expectedOldHead>
3. Verify resulting commit and tree
4. Persist task as integrated
5. Recovery: ref == old head  → never applied, retry;
             ref == new head  → applied, finish state write;
             ref == anything else → human-review
```

A **single-controller lease / fencing token** ships in Phase 1 (not Phase 4): two
simultaneous `workflowResume` calls must not both drive even a serial workflow.

### 2.3 Workflow Spec (`runtime/schemas/workflow-spec.v1.json`)

```yaml
workflowVersion: "1"
name: fix-typecheck-errors
objective: "commandRef project.typecheck exits 0 with no placeholders or weakened tests"
taskSource:
  type: plan                      # explicit | plan | command_output | file_glob
  file: docs/plans/feature-x.md   # structured task blocks, see 2.4
taskBoundary:
  maxFiles: 5
  maxDiffLines: 500               # soft limits -> warnings + split suggestion
  maxAttemptsPerTask: 2
specTemplate:
  forbiddenScope: ["migrations/**"]
  verification: [...]             # host-authorized commands, as today
review:
  reviewers: [correctness, systems]
  maxRounds: 2
  diversity: preferred            # Phase 3
decisionPolicy:
  mode: per_task_human            # per_task_human | manual_integration (batch_human deferred)
  architectCanRecommend: true
  humanConfirmationRequired: true # not configurable to false
concurrency: 1                    # Phase 4 may raise to 2, lease-gated
stopCondition:
  fixedPoint: true                # see 2.6
  commands:
    - commandRef: project.typecheck
finalReview:
  strategy: automatic
  singleReviewMaxDiffLines: 5000
```

Validation fails closed: no measurable stop condition, no task source, or unbounded
scope → rejected before any producer runs.

**Frozen trusted inputs (rev-2 review point 5).** The command registry, workflow spec,
plan, and rubrics live in the repository — which delegated tasks modify. A task must
never be able to alter what trusted host code executes next. At workflow start the
controller snapshots and pins:

```yaml
trustedInputs:
  workflowSpecHash: sha256:...
  taskSourceSnapshotHash: sha256:...
  commandRegistryHash: sha256:...
  reviewRubricHashes: { correctness: sha256:..., systems: sha256:... }
```

Commands, rubrics, and plan tasks load from the pinned snapshot for the workflow's
lifetime, never from the evolving workflow branch. `.claude-architect/commands.yaml`,
the active workflow spec, the plan file, rubric files, and runtime/adapter trust config
join a **mandatory protected-path list** appended to every generated task's
`forbiddenScope`; a diff touching them is a structural verification failure.

**Command policy (review point 9).** Workflow-executed host commands (task-source scans,
stop conditions) use `commandRef` entries resolved from a repo-committed registry
(`.claude-architect/commands.yaml`): approved executable IDs only, argv arrays (no shell
evaluation, no substitution), fixed cwd, sanitized env (no producer-supplied variables),
time/output limits, explicit network policy, raw output + exit code/signal captured as
artifacts. Arbitrary executables in a workflow file are rejected.

### 2.4 Task sources (deterministic host code, never agents)

`src/workflow/task-sources/`:

- `explicit`: inline task list in the workflow spec.
- `plan`: Markdown plan containing **schema-valid YAML task blocks** (review point 7) —
  free-form checklist parsing is rejected:

  ```yaml
  task:
    id: TASK-03
    objective: Add organization-scoped project lookup
    dependsOn: [TASK-01]
    writeAllowlist: [apps/api/src/projects/**]
    acceptanceCriteria:
      - Cross-organization reads return 404
  ```

  Dependency validation (rev-2 review correction): unique task IDs, dependency IDs must
  exist, the graph must be acyclic, a task becomes runnable only when every dependency
  is `integrated`, and a blocked/rejected dependency propagates that state to its
  dependents.

- `command_output` (Phase 2): run a registry command, parse with a named parser
  (`tsc-errors`, `vitest-failures`, `eslint`), group into bounded tasks.
- `file_glob` (Phase 2): pattern + `completedWhen` predicate — migrations/ports.

**Scope derivation (review point 8).** A task's `writeAllowlist` is derived from its
group/plan block but never auto-broadened. When a fix needs files outside the lease
(shared type, fixture, interface), the implementer reports
`BLOCKED: scope-expansion-required`; the controller creates a new spec **revision** with
an explicit expanded allowlist. Silent widening is a gate failure.

**Task identity for dynamic sources (review blocker 3).** Diagnostics are unstable
(lines move, one root cause clears many errors, errors split/merge/relocate). Every
generated task therefore carries:

```yaml
sourceEpoch: 12                  # increments per rescan of the integrated head
fingerprintVersion: 1
parserVersion: tsc-errors-v1
taskFingerprint: "sha256:..."    # normalized, line-number-free, collision-resistant
sourceFingerprint: "sha256:..."
discoveredAtHead: "abc1234"
diagnostics:
  - code: TS2322
    normalizedFile: src/example.ts
    normalizedSymbol: createUser
    normalizedMessageTemplate: "Type '{0}' is not assignable to type '{1}'"
    constructHash: sha256:...    # hash of the enclosing declaration/construct
```

Fingerprints avoid line numbers but include the normalized message template and
construct hash so distinct failures sharing a code and symbol do not collide
(rev-2 review correction).

The queue upserts by fingerprint: re-discovered work is deduplicated; queued tasks whose
fingerprint no longer appears at the current head become `superseded`; tasks generated
against an older head that conflict with integrated changes become `stale` and are
regenerated. This prevents re-enqueueing the same work and executing obsolete tasks.

### 2.5 Decision semantics (review blocker 2; revised per rev-2 review)

Acceptance authority is always the human; and under the serial head model (2.1) a
batch cannot realistically accumulate — task B run before A integrates shares A's base
and goes stale when A lands. Therefore:

- `per_task_human` (default, Phases 0–3): the controller parks each task at
  `decision-ready`; the architect session summarizes the evidence bundle and
  **recommends**; the human decides; the workflow integrates; the head advances; the
  next task runs.
- `manual_integration`: human integrates outside the workflow.
- `batch_human` is **deferred** until speculative parallel candidates and their
  stale/rebase behavior are explicitly designed (Phase 4 at the earliest).

**Enforced, not declared (rev-2 review point 2).** `workflowDecide` rejects any call
that lacks a valid **host-issued confirmation artifact** — proof the decision came from
a human UI event, not an agent tool call:

```yaml
humanDecision:
  requestId: decision-123
  evidenceBundleHash: sha256:...    # binds the decision to the exact reviewed evidence
  actorId: user-456
  confirmationEventId: ui-confirmation-789
  decision: approved
  timestamp: ...
  signature: ...                    # host-generated, runtime-verified
```

There is no mode in which any agent — implementer or architect — is the acceptance
authority. `architectCanRecommend` only controls whether recommendations are attached
to the evidence bundle.

### 2.6 Controller loop and fixed-point completion (review blockers 1, 3)

```ts
while (true) {
  await reconcileInterruptedAttempts();
  const head = await workflowBranch.head();

  const discovered = await taskSource.scan({ head, epoch: state.nextEpoch });
  await queue.upsertByFingerprint(discovered);        // dedup / supersede / stale

  const task = await queue.nextRunnable({ currentHead: head });

  if (!task) {
    const stop = await verifyStopConditions(head);    // clean worktree, registry commands
    if (!stop.passed) {
      const generated = await taskSource.fromStopFailure(stop);
      if (generated.length === 0 || state.detectsNoProgress(stop))
        return transitionWorkflow("human-review", { reason: "stop failed, no actionable work" });
      await queue.upsertByFingerprint(generated);
      continue;
    }
    const final = await reviewIntegratedBranch({ base: state.workflowBaseline, head });
    if (final.blockingFindings.length > 0) {
      await queue.upsertByFingerprint(createBoundedTasksFromFindings(final.blockingFindings));
      continue;                                        // findings re-enter the normal loop (2.7)
    }
    const finalVerification = await verifyIntegratedBranch(head);   // full suite, clean worktree
    if (!finalVerification.passed) {
      await queue.upsertByFingerprint(taskSource.fromStopFailure(finalVerification));
      continue;
    }
    if (!state.allRequiredTasksSuccessfullyTerminal())              // terminal-state classes, 2.2
      return transitionWorkflow("human-review", { reason: "unsuccessful terminal states remain" });
    return transitionWorkflow("complete");
  }

  const result = await runPipeline({ task, baseCommit: head });   // existing inner loop
  if (result.status !== "decision-ready") { await handleNonDecisionResult(task, result); continue; }

  const decision = await requestBoundDecision(result);            // human, per 2.5
  if (decision !== "approved") { await handleRejectedCandidate(task, decision); continue; }

  if ((await workflowBranch.head()) !== result.baseCommit) {      // stale-base guard
    await queue.markStale(task); await queue.requeueWithNewRevision(task); continue;
  }

  const integration = await integrateSerially(result);
  if (!integration.passed) { await queue.markIntegrationFailed(task, integration); continue; }
  await queue.markIntegrated(task, { commit: integration.commit, tree: integration.tree });
}
```

**Fixed-point completion.** A dynamic workflow is complete only when, against the same
integrated head: (1) the task source returns no new actionable tasks; (2) stop-condition
commands pass; (3) no task is pending / in-flight / decision-ready / approved /
integrating / requeued / blocked / human-review; (4) final review passes. "All tasks
terminal" alone is insufficient — `blocked` and `human-review` are terminal but not
success. No-progress detection (same stop failure fingerprints across N epochs with no
integrations) escalates to `human-review` instead of looping.

**Pipeline contract (review point 6).** `runPipeline`'s internals stay unchanged, but
its workflow-facing contract becomes explicit:

```ts
type PipelineInput  = { workflowId; taskId; attemptId; specRevision; baseCommit; delegationSpec };
type PipelineResult = { candidateCommit; candidateTree; baseCommit; artifactManifest;
                        status: "decision-ready" | "blocked" | "disputed" };
```

### 2.7 Final whole-branch review → bounded follow-up tasks (review blocker 4)

There is **no aggregate final fixer**. Final-review findings are normalized, grouped by
root cause and write scope, converted into bounded follow-up `DelegationSpec`s, and
re-enter the normal per-task pipeline; after integration the whole-branch review
repeats. Rule: *final reviewers never dispatch an unrestricted aggregate fixer; they
generate bounded remediation tasks that re-enter the normal workflow.*

`createBoundedTasksFromFindings` is deterministic host code, not an agent (rev-2 review
correction): one independent finding → one task; same root-cause fingerprint with
overlapping scope → one grouped task; ambiguous grouping → `human-review`. Each task
preserves the original finding's claim, evidence, severity, and required outcome
verbatim. Final review is followed by full final verification in a clean worktree
before `complete` (see the controller loop in 2.6).

Scaling (review point 11): aggregate diffs ≤ `singleReviewMaxDiffLines` get one
correctness+systems round; larger branches get module-sharded reviews plus one
cross-cutting integration review (interfaces, architecture, shared state) plus full
verification — findings from all shards flow into the same follow-up-task path.

### 2.8 Freshness evidence, not freshness assertion (review blocker 5)

A host-generated `sessionId` proves only that the host minted an ID. Each invocation
instead records a **freshness evidence** artifact:

```yaml
freshnessEvidence:
  invocationId: inv-123
  isolatedHome: <state>/inv-123/home
  redactedArgv: [codex, exec, --ephemeral, ...]   # secrets/sensitive paths redacted
  rawArgvHash: sha256:...
  environmentVariableNames: [...]                 # names only, never values
  sensitiveValuesStored: false
  resumeFlagPresent: false
  inheritedSessionTokenPresent: false
  contextPackageHash: sha256:...
  processId: 12345
  startedAt: ... / exitedAt: ...
  adapterCapability: enforced
```

Adapter freshness levels: `declared` (adapter claims support) < `enforced` (runtime
supplied isolation flags + environment) < `verified` (real-path test demonstrated no
inherited context). **Pipeline-role eligibility requires at least `enforced`.** Codex
(`--ephemeral`) and Pi (`--no-session`) qualify today; OpenCode/Pythinker are ineligible
for pipeline roles until they can be enforced.

The per-invocation envelope otherwise stands: `invocationId` per role invocation
(implementer, each reviewer, fixer, retry, schema-repair) with role, round, purpose,
producer/model, timestamps; artifacts namespaced
`<runs>/<workflowId>/<taskId>/<attemptId>/invocations/<invocationId>/`; a fresh-context
gate fails closed on missing or duplicate identity.

### 2.9 Durable state and metrics

`<state-dir>/workflows/<workflowId>/state.json`: queue with per-task status (2.2 model),
fingerprints, epochs, attempt counts, spec revisions, and artifact refs — written
crash-safe (`recovery-manager.ts` pattern) with a single-controller fencing token from
Phase 1 so concurrent `workflowResume` calls cannot both drive the workflow. Requeues
always get a new spec revision and fresh sessions.

Metrics ledger `<state-dir>/workflows/metrics.jsonl` — named honestly (review point 10):
**finding yield, finding acceptance rate, reviewer agreement, verification failure rate,
requeue rate, escaped defect rate, scope violation rate**, rounds/task, duration,
producer identity. True precision is computed only where ground truth exists (human
decisions, adjudication outcomes, later defect evidence). Rubrics become versioned files
so an escaped defect's correction is a rubric revision replayable against stored
hash-anchored candidates before adoption.

### 2.10 Hardening carried from the design reviews

- **Adjudicator** (Phase 3): read-only `PipelineRole` for consolidator contradictions,
  reviewer disagreement on blockers, fixer-rejected blockers, verification-vs-review
  conflict; identities stripped; resolution (or human decision) becomes a gate input;
  contradictions force `disputed`. Until Phase 3, contradictions go directly to
  `human-review`.
- **Decision binding** (Phase 0): `decideCandidate` validates the final pipeline
  artifact (final commit/tree hash, verification pass, no unresolved blocker/major)
  and records actor, rationale, accepted-risk finding ids; integration requires that
  exact artifact.
- **Reviewer diversity** (Phase 3): `diversity: preferred|required` routes correctness
  and systems to distinct producer/model families when capabilities allow, else emits
  an explicit assurance downgrade.

## 3. New surface

- MCP tools: `workflowStart`, `workflowStatus`, `workflowDecide` (records human batch
  decisions), `workflowResume`, `workflowStop`.
- Skill: `/claude-architect:workflow` — builds/validates the workflow spec with the
  architect, then supervises. `/claude-architect:delegate` unchanged as the
  single-task path.

## 4. Phasing (revised per review)

| Phase | Scope | Deliberately excluded |
| --- | --- | --- |
| **0 — Workflow correctness foundations** | Workflow branch + head model; terminal-state classes; fenced integration transaction; per-invocation identity + freshness evidence (`enforced` gate); host-bound human-decision artifact + decision binding; trusted-input snapshots + protected paths; artifact namespacing by workflow/task/attempt/invocation; serial execution only | everything else |
| **1 — Minimal workflow** | `explicit` + structured `plan` sources (with dependency validation); serial controller loop (2.6) incl. final verification gate; durable state + **single-controller fencing token**; per-task human decisions; requeue + attempt limits; stop commands via pinned registry; final review producing deterministic follow-up tasks | adjudicator, parsers, leases, metrics, batch_human |
| **2 — Dynamic work queues** | `command_output` + parser fingerprints + source epochs; `file_glob`; stale/superseded/duplicate handling; fixed-point + no-progress detection; risk profiles | — |
| **3 — Assurance hardening** | Adjudicator; reviewer diversity; versioned rubrics; incident-to-rubric flow; replay/backtesting | — |
| **4 — Controlled parallelism** | Lease conflict detection; concurrency 2; speculative candidates + `batch_human` (stale/rebase design); orphan-process + lease recovery; integration queue; shared side-effect declarations | >2 concurrency |

Verification per phase: unit tests for new modules; crash-resume tests (kill mid-queue
and mid-integration, resume); real-Codex e2e smoke on every phase (fake adapters have
hidden real sandbox bugs before); Phase 1 e2e — a 3-task plan workflow on a fixture repo
reaches fixed-point completion with all invariants' artifacts present; Phase 2 e2e —
seeded type errors driven to zero across epochs without duplicate tasks.

Pilot rule (spec §19): before Phase 4 concurrency, run one small bug-fix workflow, one
medium plan workflow, and one high-risk change through Phases 0–2 and hand-inspect
contract quality, reviewer usefulness, false-positive rate, and audit completeness.

## 5. Invariant coverage

| Dynamic-workflow invariant | Mechanism |
| --- | --- |
| 1 Fresh implementer per task | attempt runtime + invocation envelope + freshness evidence (`enforced`) |
| 2 Independent review of every result | `runPipeline` per task; nothing reaches `approved` without it |
| 3 Blocking findings → fix + fresh re-review | existing rounds; `disputed`/adjudicator (Phase 3) |
| 4 Reviewers cannot edit | sandbox-gated read-only roles (certified) |
| 5 Implementers cannot approve | human-only decision authority (2.5) + decision binding |
| 6 Artifact-only handoff | existing schemas + workflow state/fingerprint/metrics artifacts |
| 7 Objective completion | fixed-point semantics + registry stop commands; producer text never consulted |
| 8 Failures improve the workflow | metrics ledger + versioned rubrics + replay |
| 9 Durable progress | `workflows/<id>/state.json`, crash-safe, resumable mid-integration |
| 10 Whole-branch final review | sharded-capable final review whose findings re-enter the loop as bounded tasks |

## 6. Explicitly out of scope

- Any agent acceptance authority or auto-merge: contradicts the trust model; not planned.
- Agent-driven task generation: task sources stay deterministic host code.
- Free-form Markdown plan parsing: plans must contain schema-valid task blocks.
- Cross-repo workflows and >2 concurrency: revisit after Phase 4 metrics.
