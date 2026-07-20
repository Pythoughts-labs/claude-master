# Delegation Autopilot — Design Spec (2026-07-20)

## Goal

Remove every frictional pause between delegating a task and finding reviewed,
integrated work. End state for a feature: a `feat/<topic>` branch off `main`
containing one reviewed commit per delegated task, pushed with an open PR.
The human acceptance boundary moves from per-candidate `decideCandidate` to
PR review/merge. Main never advances except through a human-merged PR.

## Scope

Policy + configuration only. No runtime source changes, no schema/protocol
bump, no new MCP tools.

Changed surfaces:
1. `skills/delegate/SKILL.md` — new "Autopilot loop" section; `delegatePipeline`
   promoted to the documented default path.
2. `AGENTS.md` — trust-invariant rewording (see below).
3. `.claude/settings.json` — allowlist for runtime MCP tools and the git/gh
   commands the loop needs, so no permission prompts interrupt the flow.

## Autopilot loop

1. **Branch** — create or reuse `feat/<topic>` off `main` in the checkout.
   Never run the loop with `main` checked out as the integration target for
   commits; direct commits to `main` are prohibited.
2. **Delegate** — author a Delegation Spec per task and call `delegatePipeline`
   (independent reviewers + advisor). Plain `delegate` remains available for
   manual/step-wise use but is no longer the default.
3. **Green gate** — auto-accept is permitted only when ALL hold:
   - pipeline status is `decision-ready`;
   - verification passed (objective, recorded, rerunnable);
   - no blocking reviewer findings in the evidence bundle;
   - advisor verdict is positive.
4. **Auto-accept on green** — immediately call `decideCandidate(accepted)`,
   then `integrateCandidate` with the exact candidate `manifestHash`, then
   `git commit` on the feature branch. Commit style follows the repository;
   never AI co-author trailers or generated-by footers.
5. **Repeat** for each remaining task; each accepted task = one commit.
6. **Cleanup sweep** — after the loop, confirm no stale producer worktrees
   remain. The runtime deletes worktrees at attempt cleanup and the recovery
   manager prunes leaked ones; the sweep runs `doctor` and surfaces (does not
   hide) any cleanup failure. Finished run dirs follow existing retention.
7. **Ship** — push the feature branch (pre-push hook and CI gates still
   apply) and open a PR. The human merges (or rejects) the PR.

## Failure handling — hard stops

The loop stops at the failing task, presents the evidence verbatim, and never
auto-continues past it, on any of: a red gate condition, pipeline
`human-decision-required` or halt, verification failure, integration
`conflicted`/`aborted`, base-changed guard, or lock contention. Rejection and
revision-requested paths are unchanged: a revision means a new spec and fresh
attempt, never editing frozen bytes.

## Trust-invariant amendment (AGENTS.md)

Replace the per-candidate human-acceptance rule with:

- Agents may record `accepted` for a candidate only when every objective green
  gate holds (verification pass, no blocking independent-review findings,
  positive advisor verdict). Any non-green signal requires a human decision.
- Auto-accepted work may be committed and pushed only on a feature branch and
  proposed via PR. Merging to `main` is human-only.
- All other invariants (fresh worktrees, no self-review, frozen-byte review,
  durable evidence, whole-branch final review) are unchanged; PR review is the
  whole-branch final review surface.

## Settings allowlist

Allow without prompting: the `plugin:claude-architect:runtime` MCP tools
(`delegate`, `delegatePipeline`, `reviewCandidate`, `decideCandidate`,
`integrateCandidate`, `doctor`, `gitStatus`, `gitDiff`, `gitLog`,
`gitChangedFiles`) and the loop's git/gh commands (`git switch -c`,
`git add`/`commit`/`push` on feature branches, `gh pr create`). Destructive
git commands stay unallowed.

## Verification

- Skill/docs change: `bash scripts/validate-release.sh` doc-consistency
  checks, `claude plugin validate .`, and a real dogfood run: delegate a small
  task end-to-end and confirm the end state (feature branch, reviewed commit,
  no stale worktrees, PR opened) with zero mid-loop prompts.
- Confirm a forced non-green case (e.g. failing verification) halts the loop
  and presents evidence.
