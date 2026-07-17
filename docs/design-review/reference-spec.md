# Reference: Fresh-Context Delegation CLI Specification

This document is the benchmark specification used by the design-review delegation tasks.
Compare the claude-architect plugin (this repository) against it.

## 1. Purpose

A CLI orchestration system in which every engineering task is handled through independent, disposable agent contexts. One agent authors the implementation; different agents review it; reviewers never receive the implementer's conversation or reasoning; reviewers cannot modify code; a fresh fixer handles accepted findings; a fresh verifier tests the resulting commit from a clean checkout; the orchestrator merges only artifact-backed, independently verified work.

## 2. Core invariants

### 2.1 Fresh-context invariant
Every role invocation must: start a new process and new model session; disable conversation resume; receive only its role-specific context package; receive a unique run_id and session_id; write results to its own artifact directory; have no access to another agent's scratchpad or conversation; terminate after one bounded assignment. One task and one role per session.

### 2.2 Role-separation invariant
An agent that implements code cannot approve it. A reviewer cannot edit code. A fixer cannot perform final verification. The orchestrator coordinates state transitions but must not silently author code or waive findings.

### 2.3 Artifact-only handoff
Agents communicate through versioned artifacts, not shared chat history: task contract, context manifest, candidate commit, patch/diff, test results, structured review findings, fix disposition, verification report, final merge decision. Natural-language reasoning not captured in an approved artifact must not become hidden pipeline state.

## 3. Roles

- **Orchestrator**: owns workflow state; validates contracts; allocates worktrees; enforces path ownership; spawns fresh sessions; builds role-specific context packages; collects artifacts; consolidates duplicate findings; enforces completion gates; escalates disagreements; produces the audit record. Must not rewrite reviewer findings to reduce severity.
- **Context Scout**: read-only fresh agent producing the smallest useful context: relevant source/tests, architectural patterns, affected public interfaces, invariants, regression areas, verification commands, missing/ambiguous info. May be deterministic for simple tasks.
- **Implementer**: fresh agent producing the first candidate. Receives contract, approved context pack, baseline, allowed paths, validation commands, constraints. Does NOT receive reviewer prompts, previous findings, failed agent conversations, unrelated history, or orchestrator private reasoning. Produces candidate commit, change summary, files changed, acceptance-criterion mapping, commands executed, test evidence, limitations, assumptions.
- **Adversarial Reviewer A (Correctness)**: acceptance-criteria compliance, incorrect/missing behavior, edge cases, error handling, state transitions, data integrity, regression risk, test adequacy. Assumes the candidate is incorrect until evidence shows otherwise.
- **Adversarial Reviewer B (Systems Risk)**: security, authorization, concurrency, resource lifecycle, memory/ownership, compatibility, performance regressions, failure recovery, architectural boundary violations, hidden operational risk. Reviewers run concurrently and cannot see each other's findings before submission.
- **Findings Consolidator**: preferably deterministic logic. Normalizes formats, deduplicates, preserves highest severity, detects contradictions, assigns stable finding IDs, produces the accepted review packet. Cannot mark a blocking finding resolved.
- **Fixer**: new fresh agent. Receives contract, candidate, consolidated findings, relevant files, validation commands. Must respond to every finding with one of: fixed, already_satisfied, rejected_with_evidence, blocked, requires_human_decision. Each fix maps to a commit and verification result. Must not redesign unrelated code.
- **Clean-Room Verifier**: runs from a clean worktree at the final candidate commit. Cannot modify sources; does not receive implementer/fixer reasoning or reviewer identities; runs all required commands; checks the contract independently; confirms no tests deleted/weakened/skipped; confirms clean repo after testing; produces pass/fail.
- **Adjudicator**: third fresh agent created only when reviewers disagree on a blocker, the fixer rejects a blocking finding, a requirement has multiple defensible interpretations, or verification contradicts reviewers. Receives contract, diff, evidence, conflicting findings; reviewer identities hidden; cannot edit code.

## 4. Task contract

Every delegated task begins with an immutable YAML contract: schema_version; task id/title/objective; baseline commit+branch; scope (allowed_paths, forbidden_paths, public_interfaces_allowed_to_change); requirements as acceptance criteria with ids (AC-01...) each carrying required evidence types (integration_test, contract_snapshot...); non_goals; constraints (no weakened auth, no deleted/skipped tests, no placeholders, no destructive git, API shape unchanged); validation.required and validation.optional command lists; risk profile + domains; completion policy (all ACs required, maximum_review_rounds, require_clean_verification). Contracts are amended only by creating a new revision; prior revisions stay in audit history. Validation rejects contracts with no measurable acceptance criteria, no baseline, unbounded scope, no validation commands, contradictions, or missing write-path policy.

## 5. Context packages

Each role receives a separately generated package:
- Scout: contract, repo map, architecture docs, search starting points, read-only tool policy, output schema.
- Implementer: contract, approved context manifest, relevant source/test files, architecture constraints, command policy, output schema.
- Reviewer: contract, baseline commit, candidate commit, candidate diff, relevant source, test output, review rubric, output schema. MUST exclude: implementer conversation, chain of reasoning, confidence statements, fix suggestions from another reviewer, messages encouraging acceptance.
- Fixer: contract, current candidate, consolidated findings, relevant files, validation commands, output schema.
- Verifier: contract, final candidate commit, clean checkout instructions, validation commands, diff-scope policy, output schema.

## 6. Repository isolation

One isolated worktree per active task (.worktrees/TASK-XXXX/), one implementation branch (agents/TASK-XXXX/candidate), read-only checkouts or FS policy for reviewers, and a separate clean verify worktree. Agents must never run: git reset --hard, stash/stash pop, clean -fd, checkout -- ., restore ., push --force, rebase against a moving branch. Agents may inspect state, modify files in their worktree, stage only task-owned files, create task-scoped commits, read diffs/history. The orchestrator owns merges and branch cleanup.

File leases: before implementation the orchestrator creates a path lease (task_id, write_paths, read_paths, expires_at). Two active tasks may not hold overlapping write leases unless explicitly grouped.

## 7. Workflow state machine

draft → validated → scouting → ready → implementing → candidate_ready → reviewing → (approved | changes_required | disputed | blocked) → fixing → re_reviewing → verification → (merge_ready | verification_failed) → merged | rejected | human_review.

Every state transition requires an artifact. E.g. candidate_ready requires candidate commit + implementation report + required local command results. reviewing→approved requires all reviewer reports, no unresolved blocker, no unresolved major finding. verification→merge_ready requires clean verifier report, all required commands passing, no skipped/deleted tests, no uncommitted changes.

## 8. CLI design

`delegate init` (creates .delegation/ with config.yaml, prompts/, tasks/, runs/, findings/, schemas/); `delegate task create --id --title --from issue.md`; `delegate task validate`; `delegate scout TASK --fresh`; `delegate implement TASK --fresh`; `delegate review TASK --fresh --reviewer correctness --reviewer systems --parallel`; `delegate findings consolidate TASK`; `delegate fix TASK --fresh`; `delegate review TASK --fresh --round 2 --parallel` (round two uses new sessions); `delegate verify TASK --fresh --clean`; `delegate run TASK --profile standard`; `delegate status/inspect/findings list/logs`; `delegate decision approve|reject|waive TASK [FINDING] --reason-file` (waiver records human identity, rationale, timestamp, accepted risk); `delegate merge TASK` (refuses unless merge_ready).

## 9. Execution profiles

- low_risk: 0 scouts, 1 implementer, correctness reviewer only, fixer, clean verifier, max 2 rounds.
- standard (default): 1 scout, 1 implementer, correctness + systems reviewers, fixer, clean verifier, max 3 rounds.
- high_risk: adds security reviewer, require_re_review_after_fix, max 4 rounds. Use for auth, payments, migrations, crypto, concurrency, destructive ops, public compatibility contracts, native/unsafe code.
- competing_implementations: 2 isolated implementers + adjudicator.

## 10. Structured agent outputs

JSON reports per role. Implementation report: task_id, role, run_id, baseline_commit, candidate_commit, summary, files_changed, per-AC status+evidence, commands with exit codes, known_limitations, assumptions. Review report: verdict; findings each with id, severity, category, title, file, line range, falsifiable claim, concrete evidence, reproduction steps, required_outcome, confidence; coverage_gaps. Unsupported preferences are not blocking findings. Fix report: dispositions mapping finding_id → status + commit + evidence. Verification report: verdict, workspace_clean, tests_deleted, tests_skipped_added, scope_violations, commands with exit codes + durations, per-AC verified status.

## 11. Review severity

- **Blocker**: security vuln, data corruption/loss, incorrect authorization, crash in ordinary use, broken public contract, unrecoverable operational failure, AC failure. Must be fixed or explicitly rejected via human adjudication.
- **Major**: significant regression risk, missing important edge case, incomplete error handling, incorrect behavior under realistic conditions, material test gap, meaningful architectural violation. Fixed or explicitly waived.
- **Minor**: real but does not prevent safe delivery.
- **Nit**: non-blocking preference; never presented as a correctness failure.

## 12–15. Role prompts (summary)

Reviewer prompt: independent adversarial reviewer in fresh context; assume defects; falsify correctness; look for unsatisfied ACs, contract deviations, edge cases, security/authz/data-isolation failures, concurrency/lifetime/cleanup bugs, untested error paths, tests that pass without proving behavior, deleted/weakened/skipped/over-mocked tests, placeholders/stubs/silent fallbacks/swallowed errors, out-of-scope changes, justification comments. No file edits. Every finding: severity, exact location, falsifiable claim, evidence, reproduction, required outcome, confidence.

Implementer prompt: sole implementer, fresh context, smallest complete change satisfying every AC; no scope expansion without reporting a blocker; no deleted/skipped/weakened tests; no stubs; no swallowed errors; no destructive git; leased paths only; preserve public behavior; regression tests for corrected defects; run validation; commit only task-owned files; no self-approval.

Fixer prompt: fresh-context fixer, one disposition per finding, rejection requires direct code/test evidence, no test weakening or scope broadening, regression test for observable incorrect behavior.

Verifier prompt: clean-room, no source modification, reproduce evidence independently, verify every AC and command, repo cleanliness, changed-file scope, no test deletion/skips, no silently narrowed validation, no placeholders, regression tests exercise corrected behavior, diff based on stated baseline. Pass only when all mandatory gates satisfied.

## 16. Merge gates

Not merge_ready if: unresolved blocker; unresolved/unwaived major; unverified AC; failed required command; unrun required command without approved reason; tests deleted; new skipped/disabled tests; verifier modified sources; dirty worktree; diff touches forbidden paths; candidate off baseline; missing/invalid artifact; max review rounds exceeded; reviewer/fixer sessions resumed rather than fresh; identities or private reasoning leaked between roles. Fail closed: missing evidence means the gate is not satisfied.

## 17. Failure handling

Agent process failure: retry once in a completely new session with the same immutable input package; second failure → blocked. Invalid structured output: one schema-repair pass, then fail. Reviewer disagreement: fresh adjudicator, never shared-context negotiation. Flaky test: record all executions; a passing rerun does not erase a prior failure; blocked until explained+corrected or explicitly waived. Max review rounds: stop and move to human_review. Scope expansion discovered: stop and generate a proposed contract revision.

## 18. Process-learning loop

On review-caught defects: regression test, record category, which reviewer caught it, whether validation should have caught it, improve rubric/template. On escaped defects: regression test, identify the failed gate, modify process not just code, add pattern to reviewer corpus, backtest against historical changes for false positives. Track: finding precision, blocking-finding acceptance rate, escaped defects per task, reopened tasks, verification failures, avg review rounds, scope violations, test-weakening attempts, agent process failures, cost per verified task.

## 19. Pilot rollout

Pilot on three representative tasks (small bug fix, medium feature, high-risk auth/lifecycle change) before scaling concurrency. Inspect contract quality, context sufficiency, scope discipline, reviewer usefulness, false-positive rate, fixer behavior, clean-room verification, audit completeness. Initial limits: 2 active tasks, 1 implementer/task, 2 parallel reviewers/task, 1 fixer/task, 1 verifier job; max 3 review rounds, 1 retry/phase, 900s command timeout, 500-line diff and 12-file soft limits (warnings, not failures).

## 20. Definition of done

The system can prove: every role received a distinct fresh session; reviewer contexts excluded implementer conversation; reviewers could not write; two reviewers submitted independently; findings consolidated without severity loss; fixer addressed every accepted finding; a fresh review round evaluated the fixed candidate; a clean verifier reproduced all mandatory evidence; merge refused incomplete tasks; full task history reconstructable from stored artifacts; no completion decision depends solely on an agent's confidence statement.
