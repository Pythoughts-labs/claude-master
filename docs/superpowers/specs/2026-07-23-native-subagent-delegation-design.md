# Native Subagent Delegation — Design (rev 2)

Date: 2026-07-23
Status: proposed (rev 2 after adversarial review; rev 1 rejected)
Review verdict driving this revision: same-repo lanes serialize on the repo lock (`src/mcp/tools.ts:278-279`), serial integration cannot compose multiple candidates on one clean checkout (`src/integrate/controlled-integrator.ts:68-79`), `agentType` passthrough was a trust bypass, Workflow completion is asynchronous, and the rev 1 lane contract used fields the runtime does not emit.

## Problem

Delegations run as synchronous foreground MCP calls in the main session. After ~120 s the host collapses the call into "1 MCP task still running": no per-lane spinner, no stats, no view of what is running and what is left. Goal: surface delegation lanes through the native Claude Code subagent UI, without weakening any trust invariant and without claiming parallelism the runtime does not provide.

## Ground truth about concurrency (binding for this design)

- Both delegation handlers serialize on `gitCommonDir`; all lanes against the **same repository** (including its worktrees) run one at a time. This design does not change that.
- True concurrency exists only **across independent repositories** (disjoint `gitCommonDir`s).
- Integration stages without committing and guards on `base-changed` + clean checkout: at most **one accepted candidate per clean checkout**; the human commits (or discards) before the next integration on that checkout.
- Real same-repo fleet parallelism requires runtime work (Phase B). Phase A is visibility only.

## Phase A — Visibility via one generic lane agent (target 0.28.0, no runtime changes)

Phase A changes plugin content only (`agents/`, `skills/`, tests, docs). "No runtime changes" is now true because Phase A makes no concurrency claim beyond what the runtime already provides.

### A1. One agent file: `agents/delegation-lane.md`

One generic lane runner instead of four near-identical producer agents; the producer is selected by the spec's `producerPreferences`, not by agent identity.

```yaml
---
name: delegation-lane
description: Runs ONE claude-architect delegation lane (produce + verify only) so it surfaces as a native subagent. Input is a laneId, checkoutPath, protocolVersion, and a complete Delegation Spec; output is the structured lane report. Never reviews, decides, or integrates.
tools: mcp__plugin_claude-architect_runtime__delegate, mcp__plugin_claude-architect_runtime__delegatePipeline
model: haiku
---
```

- Tools are exactly the two dispatch calls. No Read/Grep/Glob/doctor/Bash/Write/Edit: the agent cannot inspect the repo, probe the environment, or mutate anything. Review/decision/integration tools are unreachable by construction.
- `model: haiku`, low effort: the agent is a courier, not a thinker. The architect invokes it with `run_in_background: true` default and bounded turns.
- Known limitation, stated in the agent body and README: the host injects CLAUDE.md hierarchy and git status into custom subagents. The agent is instructed to ignore repository lore, but this is instruction, not enforcement; the enforced boundary is the tool allowlist, and the Producer itself still only ever sees the spec via the trusted runtime.

Agent body contract:

1. You are a courier for exactly one delegation attempt. Do not redesign, reinterpret, or "improve" the spec.
2. Call `delegate` (or `delegatePipeline` when the prompt says `pipeline: true`) with the `checkoutPath`, `spec`, and `protocolVersion` from your prompt. Keep the call foreground until it returns. Never retry on your own.
3. Your final message is a single JSON object and nothing else:

```json
{
  "laneId": "<echoed from prompt>",
  "specSha256": "<echoed from prompt>",
  "ok": true,
  "status": "<result.status verbatim, or null when ok:false>",
  "runId": "<result.runId or null>",
  "producerId": "<result.producerId or null>",
  "manifestHash": "<result.candidate.manifestHash or null>",
  "failure": "<result.failure verbatim, or null>",
  "validationErrors": "<validationErrors verbatim when ok:false, else null>",
  "durationMs": 0
}
```

   Field sourcing is fixed: `status`/`failure`/`runId`/`producerId` are copied verbatim from the MCP result; `manifestHash` comes from `result.candidate.manifestHash` for `delegate` and from the pipeline result's candidate location for `delegatePipeline`; `laneId` and `specSha256` are echoed from the prompt so the architect can correlate without trusting the model's memory.
4. Never claim acceptance, never summarize the patch, never treat the Producer self-report as evidence.

### A2. Architect-side correlation (SKILL.md)

The lane report is model-mediated and therefore untrusted for anything but correlation. The architect:

- computes `specSha256` over the exact spec JSON before dispatch and includes `laneId` + `specSha256` in the lane prompt;
- on completion, uses only `runId` from the report to call `reviewCandidate` in the main session — every reviewable fact (patch, manifest, verification evidence, status) comes from `reviewCandidate`/the run's durable artifacts, never from the lane JSON;
- on a malformed or missing lane report, does **not** redispatch. It lists run dirs under the state dir per the existing monitoring section, finds the run whose spec matches `specSha256` (the run dir records the spec), and resumes from its `result.json`. Redispatch happens only when no matching run directory exists — this prevents duplicate attempts after a successful but badly-reported run.

### A3. Dispatch rules (SKILL.md, new section "Lanes as native subagents")

- **Independent repositories** (disjoint `gitCommonDir`s): dispatch one `delegation-lane` agent per repo, all in a single message; they genuinely run concurrently and the host renders the native agent tree.
- **Same repository**: lanes still surface as subagents for visibility, but the skill states plainly that the runtime serializes them on the repository lock; dispatch them and expect sequential execution, or dispatch sequentially to keep timeout budgets honest. Never advertise same-repo parallelism.
- Single-lane delegation may still use the direct foreground MCP call; prefer the lane agent whenever the call will outlive the ~120 s background threshold.
- Decision and integration tail, per repository: `reviewCandidate` → canonical card → human decision → `integrateCandidate` → **stop until the human commits or discards the staged tree** → only then the next accepted candidate for that checkout. At most one accepted candidate per clean checkout; the skill forbids batch-accepting multiple candidates targeting one checkout.
- Decisions for lanes on *different* repositories may be presented together in one structured question; their integrations are still per-repo gated as above.

### A4. Canonical completion card

Rendered by the architect from `reviewCandidate` evidence only:

```text
┌ ✓ delegation-lane · codex · verified-candidate ─────────
│ lane task1 · 1 file changed · verification 2/2 pass
│ producer self-report conflicts: <one line or "none">
│ manifestHash cebcb2a8…
│ ◑ YOUR DECISION: accept / reject / revise
└──────────────────────────────────────────────────────────
```

Fixed glyphs: `●` running (host-rendered) · `◑` human decision pending · `✓` verified/accepted · `✗` failed/unavailable/cancelled/rejected. The decision line appears only on decision-bearing outcomes. The rev 1 hand-rendered dispatch card and live-status line remain solely as the fallback for direct (non-subagent) calls.

### A5. Wiring-test migration (`tests/runtime/plugin-wiring.test.mjs`)

- Legacy must-not-ship list: keep every existing entry, including all four `agents/*-implementer.md` paths — those legacy per-producer agents stay banned. Add nothing to `agents/` except `delegation-lane.md`.
- New positive assertions for `agents/delegation-lane.md`:
  - frontmatter `tools:` is exactly the two dispatch tools (assert both present; assert absence of `reviewCandidate`, `decideCandidate`, `integrateCandidate`, `Bash`, `Write`, `Edit`, `Read`, `Grep`, `Glob`, `doctor`);
  - body contains `laneId`, `specSha256`, `"failure"` (the runtime's field name), and `/[Nn]ever review/u`.
- SKILL.md assertions: contains `## Lanes as native subagents`, contains the same-repository serialization sentence (match on `serializ`), contains the one-accepted-candidate-per-clean-checkout rule; all existing lifecycle assertions unchanged.
- Version surfaces `0.28.0` (plugin.json, marketplace.json, README badge, CHANGELOG, this test).

### A6. Dogfood smoke (must exercise the defect the reviewer flagged)

1. Two lanes, two disjoint tmp repos → confirm genuine concurrency and two independent review/decide/integrate tails.
2. Two lanes, one shared tmp repo → confirm the second lane blocks on the repo lock and completes after the first (observed serialization, no timeout misclassification), and confirm the second integration on that checkout is refused until the first staged tree is committed.
Bugs land in `scratchpad.md` as dogfood regressions.

### A7. Out of scope for Phase A

No `src/`/`runtime/` changes; protocol stays 1.3.0. No same-repo parallelism. No Workflow tool usage.

## Phase B — Real fleet support (runtime work; separate spec before implementation)

Rev 1's "Workflow fan-out with no runtime changes" is rejected: same-repo fleets need runtime semantics that do not exist yet. Phase B is scoped here only as requirements; it gets its own design + adversarial review before any implementation, and its own protocol/version increments.

Required runtime capabilities:

1. **Frozen fleet base**: a fleet is opened against one recorded base commit; every lane's candidate anchors to that base, and the fleet rejects dispatch if HEAD moves.
2. **Fleet lease**: a shared lease keyed on `gitCommonDir` + fleetId that permits N concurrent lane attempts in runtime-managed worktrees while still excluding non-fleet writers; replaces the current one-attempt repo lock for fleet members only.
3. **Correlation IDs**: laneId/fleetId recorded in `run-start.json` and `result.json` so orchestration state is durable and recoverable, not model-mediated.
4. **Deterministic result projection**: a runtime-emitted per-lane summary artifact (the A1 JSON, but written by the runtime) so no model transformation sits between runtime truth and the architect.
5. **Serial-head decision semantics**: candidates are reviewed/accepted one at a time against the moving head; on `base-changed`, the runtime offers deterministic rebase-or-requeue of the frozen candidate (cherry-pick lane recovery formalized), never silent recomposition.
6. **Workflow orchestration (UI layer only)**: a plugin-shipped `workflows/delegate-fleet.mjs` whose `agent()` calls use a **fixed producer enum mapped to the single `delegation-lane` agent** — no caller-supplied `agentType` (trust bypass closed). The script performs no review/decide/integrate. The skill text handles Workflow's asynchronous completion explicitly: dispatch returns immediately; the architect acts only on the completion notification, and on session loss recovers from the durable correlation artifacts of (3). Explicit human approval before any fleet launch, per AGENTS.md.

Acceptance gate for Phase B: a design spec covering lease semantics, crash recovery, and adversarial cases (lease starvation, fleet member escaping its worktree, base race between decision and integration), reviewed with the same rigor as this revision.

## Error handling summary (Phase A)

- `ok:false` + `validationErrors` → lane echoes them in the report's `validationErrors` field; architect repairs the spec (repair never reaches a Producer) and redispatches.
- Malformed/missing lane report → recover via `specSha256` run-dir match per A2; redispatch only when no run dir exists.
- Same blocker from two lanes → existing coordinator duty unchanged: pause, fix centrally, redispatch.
- Lane agent attempting a forbidden tool → host denies; architect reports a lane defect.

## Verification plan (Phase A)

`npx tsc --noEmit`, `npx vitest run`, `bash scripts/validate-release.sh`, `claude plugin validate .` all green, plus the A6 smoke including the shared-repo serialization case.

## Decision record

- Rev 1 rejected on review: parallel same-repo claim contradicted `withRepoLock`; multi-candidate serial integration contradicted the integrator's base guard; `agentType` passthrough bypassed the produce-only boundary; lane contract fields didn't match runtime output. All verified against source before this rewrite.
- One generic lane agent replaces four per-producer agents: producer identity already lives in the spec; four files quadrupled the model-mediated transformation surface.
- Lane agent as courier (haiku, two tools, background): visibility is the deliverable; intelligence in the lane only adds untrusted mediation.
- Phase B deferred behind its own spec: fleet semantics are runtime trust-boundary work, not plugin packaging.
