# Role Separation and Review Pipeline

This review compares Claude Architect's implemented pipeline with the role-separation invariant and the Correctness Reviewer, Systems Risk Reviewer, and Adjudicator roles in Sections 2.2, 3.4, 3.5, and 3.9 of the reference specification. The short conclusion is that the plugin has strong mechanical separation between an untrusted implementer, read-only reviewers, a write-capable fixer, and host-controlled verification, but it does not yet implement the reference adjudicator and does not fully represent role identity and independence as auditable invariants.

## Current Design

The initial candidate is produced by the ordinary isolated attempt runtime before `runPipeline` begins (`src/pipeline/pipeline-runtime.ts`). That attempt must return `verified-candidate`; otherwise the pipeline fails. The implementer does not receive an approval capability. The MCP server also rejects nested startup when `CLAUDE_ARCHITECT_DELEGATED` is present (`src/mcp/server.ts`), while acceptance and integration remain separate host-facing operations in `handleDecideCandidate` and `handleIntegrateCandidate` (`src/mcp/tools.ts`). Integration requires a recorded `accepted` decision and rechecks the candidate artifact hash. Thus a Producer cannot directly approve or integrate its own output through the intended runtime path.

After implementation, `runReviews` launches the configured correctness and systems roles with `Promise.all`. Each call to `runRole` builds a new invocation, fresh temporary home, and supervised process. Both receive the same immutable-looking role package: spec, baseline and candidate commits, candidate diff, and implementation test evidence. Neither receives the other review. Their prompts are explicitly adversarial and have distinct rubrics: correctness covers acceptance criteria, behavior, edge cases, error handling, regressions, and test adequacy; systems covers security, authorization, concurrency, lifecycle, compatibility, performance, and architecture (`src/pipeline/role-prompts.ts`).

Reviewers and the modeled verifier are listed in `READ_ONLY_ROLES`. `buildRoleSpec` gives them an empty write allowlist and forbids `**/*`; `runRole` additionally requires either a Producer-native read-only sandbox or host OS write confinement. A role is refused when confinement is unavailable. This is substantially stronger than prompt-only restraint and enforces that reviewers cannot edit.

The deterministic consolidator deduplicates findings, preserves the highest severity, records originating reviewer labels, and reports conflicting required outcomes at the same location (`src/pipeline/consolidator.ts`). A fresh fixer process then receives only the common package plus consolidated findings, has only the original write allowlist, must disposition every finding, and is told not to perform final verification. Fixes are re-reviewed in a subsequent loop iteration. Final verification is actually performed by trusted host code in `verifyCandidate`, in a separate worktree created at the final commit. It runs structural and project verification, checks scope and baseline ancestry, detects deleted or newly skipped tests, checks worktree cleanliness, and feeds a deterministic gate. Although a `verifier` prompt and read-only role exist, the pipeline does not invoke that agent role.

Finally, the delegate skill requires the architect to inspect the evidence bundle. `decision-ready` is not self-merging: the architect records a decision, and integration is a later hash-bound action. For `human-decision-required`, the skill says to present unresolved findings verbatim and never accept on the human's behalf (`skills/delegate/SKILL.md`). The legacy implementer agent definitions likewise say their output is untrusted and requires architect review, but their own “verify independently” steps are implementation-lane validation rather than clean-room final verification.

## Spec Comparison

| Reference requirement | Assessment | Evidence and qualification |
| --- | --- | --- |
| Section 2.2: implementer cannot approve | Largely enforced | Producer execution and host decision/integration are separate; nested delegated MCP startup is denied. However, the architect session that authors the spec also performs the final evidence review and can record acceptance, so organizational independence depends on the host workflow rather than a distinct adjudicator identity. |
| Section 2.2: reviewer cannot edit | Enforced for pipeline roles | Empty write allowlist, global forbidden scope, and mandatory native or host read-only confinement fail closed when unavailable. |
| Section 2.2: fixer cannot perform final verification | Enforced by topology, partially by prompt | The fixer is write-capable and may run local validation, as it should, but final gate evidence is generated afterward by trusted code in a fresh worktree. The prohibition is not an explicit capability flag; it follows from the fixer having no route to emit the accepted `VerificationReport`. |
| Section 3.4: independent adversarial correctness reviewer | Mostly met | Dedicated rubric, fresh process/home, read-only sandbox, structured report, concurrent launch, and no peer findings in the package. Criterion coverage is unusually explicit. |
| Section 3.5: independent adversarial systems reviewer | Mostly met | Dedicated systems rubric and the same isolation properties. Default configuration includes both reviewer kinds. |
| Sections 3.4/3.5: reviewers run concurrently and cannot see each other before submission | Met in the normal round | `Promise.all` starts both from the same package. Consolidation occurs only after both structured reports are returned. Schema-repair retries reuse that role's package and still do not include peer findings. |
| Section 3.9: fresh adjudicator for disagreement/rejected blockers/ambiguous requirements/verification conflict | Not implemented | There is no adjudicator role, prompt, schema, runner branch, or artifact. Consolidator `contradictions` are recorded but never drive a state transition. Rejected blocking findings and other unresolved blockers are routed directly to `human-decision-required`. |

The reviewers are independent in context and timing, but not guaranteed to be diverse in model or Producer. Routing happens separately for each role using the same preferences and capability reports, so both reviews may use the same Producer/model. This still satisfies process/session independence, but it is weaker adversarial independence than a policy that deliberately separates model families. Also, the same `runId` is passed to every role; role logs distinguish role and round, but the report schemas do not record unique role session IDs. The implementation therefore performs fresh invocations without producing all the identity evidence needed to prove freshness later.

## Gaps

1. **No adjudication stage.** `consolidate` detects a narrow class of contradictions, but `runPipeline` neither invokes a third fresh role nor supplies conflicting evidence to one. A fixer disposition of `rejected_with_evidence`, `blocked`, or `requires_human_decision` goes through `evaluateGates` directly to a human. Verification disagreement likewise has no machine-assisted neutral review.

2. **Contradictions are passive metadata.** Contradictions do not force a `disputed` state, prevent the fixer from receiving mutually incompatible outcomes, or become explicit gate reasons. Furthermore, contradiction detection only compares differing required outcomes at an identical location; semantic conflicts across locations or conflicting verdicts on the same criterion can be missed.

3. **Freshness is operational but under-documented.** Every role invocation is a new process with a fresh temporary home, yet all roles share the task `runId`, and structured review/fix/verification reports contain no role invocation ID, session ID, Producer/model identity, context-package digest, or explicit “resume disabled” evidence. Audit consumers cannot conclusively establish that two reports came from distinct sessions using artifacts alone.

4. **Reviewer diversity is not guaranteed.** Correctness and systems prompts are distinct and concurrent, but routing can select the same Producer and model for both. There is no configurable diversity constraint or warning when both adversarial perspectives collapse onto one model family.

5. **The verifier abstraction and runtime diverge.** A clean-room verifier prompt, schema, and read-only role exist, but `runPipeline` bypasses them in favor of deterministic host verification. Host verification is preferable for command execution and objective checks, but it does not independently reason through every acceptance criterion as Section 3.9's conflict trigger assumes, and dead verifier-role code can mislead maintainers about actual guarantees.

6. **Decision identity is thin.** `RunDecision` records decision and timestamp, but the exposed `decideCandidate` operation does not capture actor identity, rationale, adjudication artifact, or accepted risk. The skill supplies a human stop for unresolved blockers, but the stored decision boundary is not rich enough to prove who resolved a dispute or why.

7. **Role separation is split between runtime and prose for legacy lanes.** The MCP pipeline mechanically confines reviewers. By contrast, the legacy agent files primarily require architect review and lane-local re-verification through instructions. They do not constitute the same structured multi-review/fix/adjudication pipeline and should not be described as equivalent assurance.

## Recommendations (prioritized)

### P0 — Add an explicit adjudication path and fail-closed gates

Introduce `adjudicator` as a read-only `PipelineRole`, with its own structured report and fresh invocation. Trigger it when: consolidator contradictions exist; reviewers disagree on a blocking claim or criterion; a fixer rejects a blocker; requirements have competing defensible interpretations; or final verification conflicts with review evidence. Give it only the spec, candidate diff, normalized conflicting claims, and relevant command evidence, with reviewer identities removed. It must not edit. Persist its report and make the gate require either an adjudicator resolution or a recorded human decision. Contradictions should immediately produce a disputed state rather than flowing silently into fixing.

### P0 — Bind acceptance to the pipeline result, not only the initial attempt

Make the decision API load and validate the final pipeline artifact: final candidate commit/tree/hash, successful verification, no unresolved blocker or unwaived major, and any required adjudication. Record actor, rationale, timestamp, accepted-risk finding IDs, and the exact pipeline artifact digest. Integration should require that exact final pipeline artifact. This turns “the skill says not to accept” into a runtime-enforced rule and prevents a generic accepted decision from bypassing pipeline findings.

### P1 — Make role freshness and identity auditable

Generate a unique invocation/session ID for every reviewer, fixer, verifier, repair attempt, and adjudicator invocation while retaining the parent task run ID. Store role, round, Producer/model, process/session freshness flags, context-package hash, candidate commit, start/end time, and resume-disabled evidence in each artifact. Gates should reject duplicate session IDs, missing context hashes, or resumed sessions.

### P1 — Keep deterministic verification and add independent acceptance review

Retain host-side clean-worktree verification as the authoritative executor for objective commands. Then either remove the unused verifier role to make the design honest, or invoke a fresh read-only verifier after deterministic checks to map every criterion to independently reproduced evidence and detect weakened-but-not-deleted tests or semantic scope violations. The verifier must receive the host results but not implementer/fixer reasoning or reviewer identities, and its failure must block acceptance.

### P1 — Strengthen adversarial reviewer independence

Add optional policy fields such as `requireDistinctSessions: true` and `reviewerDiversity: preferred|required`. When capabilities permit, route correctness and systems reviews to different Producer/model families; otherwise emit an explicit assurance downgrade in the pipeline result. Preserve concurrent submission and never include peer output in retries or schema repair.

### P2 — Expand deterministic disagreement detection

Normalize findings by acceptance-criterion ID and falsifiable claim, not only exact location plus claim text. Detect approve/request-changes conflicts, incompatible criterion verdicts, and conflicting required outcomes across related locations. Preserve each reviewer's original evidence verbatim alongside the consolidated record so neither consolidation nor adjudication can silently lower severity.

### P2 — Clarify assurance levels in documentation and schemas

Document three distinct checks: implementer-local validation, deterministic clean-worktree verification, and independent semantic review. State that legacy lanes provide candidate production only and acquire full assurance only when their artifact enters the MCP pipeline. Rename or remove unused role surfaces so the documented role graph matches the executed state machine.
