import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../platform/posix-platform-services.js";
import { RuntimeError } from "../util/errors.js";
import { git, type GitResult } from "./git-exec.js";

const MAX_DIAGNOSTIC_LENGTH = 2_000;

function failure(action: string, result: GitResult): RuntimeError {
  const diagnostic = (result.stderr || result.stdout).trim().slice(0, MAX_DIAGNOSTIC_LENGTH);
  return new RuntimeError(`${action} failed${diagnostic ? `: ${diagnostic}` : ""}`);
}

export class WorktreeManager {
  constructor(
    private readonly repoRoot: string,
    private readonly runId: string,
  ) {}

  async create(baseCommitOid: string): Promise<{ path: string; cleanup(): Promise<void> }> {
    const worktreesRoot = path.resolve(resolveStateDir(), "worktrees");
    const worktreePath = path.resolve(worktreesRoot, this.runId);
    if (worktreePath === worktreesRoot || !worktreePath.startsWith(`${worktreesRoot}${path.sep}`)) {
      throw new RuntimeError("invalid worktree run id");
    }
    await mkdir(worktreesRoot, { recursive: true });
    const result = await git(this.repoRoot, ["worktree", "add", "--detach", worktreePath, baseCommitOid]);
    if (result.exitCode !== 0) {
      await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
      throw failure("git worktree add", result);
    }
    return {
      path: worktreePath,
      cleanup: () => this.remove(worktreePath),
    };
  }

  async remove(worktreePath: string): Promise<void> {
    const result = await git(this.repoRoot, ["worktree", "remove", "--force", worktreePath]);
    await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    if (result.exitCode !== 0) throw failure("git worktree remove", result);
  }
}
