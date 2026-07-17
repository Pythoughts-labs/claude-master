# Plugin Components

This inventory describes the shipped surfaces relevant to marketplace review. The release manifest is `.claude-plugin/plugin.json` (Claude Architect 0.15.0 at the time of this document), licensed MIT.

## Skill

`skills/delegate/SKILL.md` defines `/claude-architect:delegate`. It instructs Claude to build a versioned Delegation Spec, choose a Producer explicitly, call the MCP lifecycle, review exact frozen bytes, record a human decision, and integrate only an accepted candidate whose manifest hash matches. It recommends `delegatePipeline` for non-trivial changes and documents the legacy migration fallback. The skill itself is orchestration text; it does not directly receive Bash or file-edit tools.

## Agents

| Component | Purpose and declared restrictions |
|---|---|
| `agents/advisor.md` | Strictly non-mutating advisor. Declares read-only repository tools and no Bash or edit authority. |
| `agents/claude-advisor.md` | Legacy/read-only architecture advisor; reads before opining and must not mutate. |
| `agents/codex-implementer.md` | Legacy Codex lane supervisor. Declares Bash/Read/Grep/Glob, invokes Codex through the isolated runner with `workspace-write`, offline sandbox, ephemeral config, and no child agents; independently reviews diff/tests. Not the fallback for a denied certified MCP lane. |
| `agents/opencode-implementer.md` | Legacy OpenCode supervisor with Bash/read/search access. Runs the selected CLI through an isolated adapter and verifies its changes. |
| `agents/pi-implementer.md` | Legacy Pi supervisor with Bash/read/search access. Uses a one-shot/no-session invocation and deterministic tool subset; provider/model is configuration-dependent. |
| `agents/pythinker-implementer.md` | Legacy Pythinker supervisor with Bash/read/search access. Invokes unattended `--yolo`; this high-autonomy output requires independent review. |

Agent frontmatter restrictions constrain Claude Code's agent wrapper; the external CLI still has the authority granted by its adapter and OS sandbox. OpenCode, Pi, and Pythinker are migration lanes, not certified MCP Codex equivalents.

## MCP tools

`src/mcp/server.ts` exposes these tools over stdio:

| Tool | Authority |
|---|---|
| `delegate` | Validate one spec, run one isolated Producer attempt, freeze and independently verify a candidate. |
| `delegatePipeline` | Run implementation plus fresh-context correctness/systems review, fix rounds, gates, and clean-room verification. It never accepts or integrates automatically. |
| `reviewCandidate` | Read-only regeneration of the exact anchored patch, changed-path manifest, and evidence. |
| `decideCandidate` | Record accepted/rejected/revision-requested. Acceptance requires a verified candidate; rejection removes its candidate anchor. |
| `integrateCandidate` | Apply an accepted tree only after exact manifest-hash and identity revalidation. Stages changes; does not commit. |
| `doctor` | Read runtime, Git, Producer capability, sandbox, and platform diagnostics. |
| `gitStatus`, `gitDiff`, `gitLog`, `gitChangedFiles` | Bounded, redacted Git reads with external diff/textconv behavior disabled where applicable. They do not mutate the repository. |

The MCP server has no generic command-execution endpoint. Verification execution is reachable only through a validated Delegation Spec.

## Runtime modules

- `src/runtime/attempt-runtime.ts`: lifecycle orchestration, policy, state, and result production.
- `src/producers/*`: Producer discovery, capability reporting, routing, prompt/argv construction, and result parsing.
- `src/platform/*`: executable resolution, process-group/job supervision, checkout locks, process start tokens, and sandbox selection.
- `src/git/worktree-manager.ts` and `candidate-tree.ts`: detached worktrees, change inventory, scope enforcement, candidate Git objects/refs, and manifest hash.
- `src/verify/*`: structural and project verification in a separate worktree.
- `src/pipeline/*`: fresh role invocations, adversarial review/fix reports, consolidation, gates, and final verification.
- `src/runtime/artifact-store.ts`, `run-manifest.ts`, and `recovery-manager.ts`: bounded/redacted archives, provenance hashes, pruning, and crash recovery.
- `src/integrate/controlled-integrator.ts`: locked, hash-gated candidate tree application.
- `runtime/bootstrap.mjs` and `runtime/server.mjs`: packaged executable JavaScript loaded by Claude Code.

## Hooks and scripts

The plugin contains no marketplace/runtime hook declaration under a `hooks/` directory. Repository development uses `.githooks/pre-push`, which is not installed as a Claude Code plugin hook and only runs when a contributor configures Git's `core.hooksPath`. Shell scripts under `scripts/` provide legacy isolated lane launchers, release validation, and development/install checks. They may invoke `bash`, Producer CLIs, timeout/process utilities, Node.js, Git, and test/build commands according to their specific script.

## Tool restriction summary

Implementation Producers may edit only in an isolated worktree and are checked against allowlist/forbidden scope. Pipeline reviewers and verifier are configured read-only with all writes forbidden. The fixer alone receives bounded edit authority. The Host runs only spec-authorized verification commands. Acceptance and integration remain separate MCP calls controlled by the architect/human workflow.
