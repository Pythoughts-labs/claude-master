import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freezeCandidate } from "../../src/git/candidate-tree.js";
import { git } from "../../src/git/git-exec.js";

const temporaryPaths: string[] = [];

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function initRepoAndWorktree(
  files: Record<string, string> = { "a.txt": "hello\n" },
): Promise<{ repoRoot: string; worktreePath: string; baseCommitOid: string; baseTreeOid: string }> {
  const root = await mkdtemp(join(tmpdir(), "ca-candidate-tree-"));
  temporaryPaths.push(root);
  const repoRoot = join(root, "repo");
  const worktreePath = join(root, "worktree");
  await mkdir(repoRoot);
  await runGit(repoRoot, ["init", "-q"]);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(repoRoot, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents);
  }
  await runGit(repoRoot, ["add", "-A"]);
  await runGit(repoRoot, ["commit", "-q", "-m", "init"]);
  const baseCommitOid = await runGit(repoRoot, ["rev-parse", "HEAD"]);
  const baseTreeOid = await runGit(repoRoot, ["rev-parse", `${baseCommitOid}^{tree}`]);
  await runGit(repoRoot, ["worktree", "add", "--detach", "-q", worktreePath, baseCommitOid]);
  return { repoRoot, worktreePath, baseCommitOid, baseTreeOid };
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("freezeCandidate", () => {
  it("rejects out-of-scope writes", async () => {
    const fixture = await initRepoAndWorktree();
    await writeFile(join(fixture.worktreePath, "a.txt"), "allowed\n");
    await writeFile(join(fixture.worktreePath, "b.txt"), "outside\n");

    const result = await freezeCandidate({
      ...fixture,
      runId: "run-out-of-scope",
      writeAllowlist: ["a.txt"],
      forbiddenScope: [],
    });

    expect(result).toEqual({ ok: false, reason: "out-of-scope-write" });
  });

  it("freezes an allowed edit into a content-addressed tree", async () => {
    const fixture = await initRepoAndWorktree();
    await writeFile(join(fixture.worktreePath, "a.txt"), "updated\n");

    const result = await freezeCandidate({
      ...fixture,
      runId: "run-allowed",
      writeAllowlist: ["a.txt"],
      forbiddenScope: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.baseCommitOid).toBe(fixture.baseCommitOid);
      expect(result.artifact.candidateTreeOid).toMatch(/^[0-9a-f]{40}$/);
      expect(result.artifact.candidateTreeOid).not.toBe(fixture.baseTreeOid);
      expect(result.artifact.candidateCommitOid).toMatch(/^[0-9a-f]{40}$/);
      expect(result.artifact.anchorRef).toBe("refs/claude-architect/candidates/run-allowed");
      expect(result.artifact.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.artifact.changedPaths).toEqual([
        {
          path: "a.txt",
          changeType: "modified",
          mode: "100644",
          contentHash: expect.stringMatching(/^[0-9a-f]{40}$/),
        },
      ]);
      expect(result.artifact.patch).toContain("a.txt");
      expect(result.artifact.patch.length).toBeGreaterThan(0);
      expect(await runGit(fixture.repoRoot, ["rev-parse", result.artifact.anchorRef])).toBe(
        result.artifact.candidateCommitOid,
      );
    }
  });

  it.skipIf(process.platform === "win32")("rejects a symlink added by the producer", async () => {
    const fixture = await initRepoAndWorktree();
    await symlink("a.txt", join(fixture.worktreePath, "link.txt"));

    const result = await freezeCandidate({
      ...fixture,
      runId: "run-symlink",
      writeAllowlist: ["link.txt"],
      forbiddenScope: [],
    });

    expect(result).toEqual({ ok: false, reason: "modified-symlink" });
  });

  it.skipIf(process.platform === "win32")("fast-fails an obvious symlink before building the index", async () => {
    const fixture = await initRepoAndWorktree();
    await symlink("a.txt", join(fixture.worktreePath, "link.txt"));

    const result = await freezeCandidate({
      ...fixture,
      baseCommitOid: "0".repeat(40),
      runId: "run-symlink-fast-fail",
      writeAllowlist: ["link.txt"],
      forbiddenScope: [],
    });

    expect(result).toEqual({ ok: false, reason: "modified-symlink" });
  });

  it("rejects an empty candidate", async () => {
    const fixture = await initRepoAndWorktree();

    const result = await freezeCandidate({
      ...fixture,
      runId: "run-empty",
      writeAllowlist: ["a.txt"],
      forbiddenScope: [],
    });

    expect(result).toEqual({ ok: false, reason: "empty-candidate" });
  });

  it("rejects a write inside forbidden scope even when allowlisted", async () => {
    const fixture = await initRepoAndWorktree({ "src/private.txt": "base\n" });
    await writeFile(join(fixture.worktreePath, "src/private.txt"), "changed\n");

    const result = await freezeCandidate({
      ...fixture,
      runId: "run-forbidden",
      writeAllowlist: ["src/**"],
      forbiddenScope: ["src/private.txt"],
    });

    expect(result).toEqual({ ok: false, reason: "out-of-scope-write" });
  });

  it("stages paths containing pathspec metacharacters literally", async () => {
    const fixture = await initRepoAndWorktree({ "foo[1].ts": "base\n" });
    await writeFile(join(fixture.worktreePath, "foo[1].ts"), "changed\n");

    const result = await freezeCandidate({
      ...fixture,
      runId: "run-literal",
      writeAllowlist: ["foo[1].ts"],
      forbiddenScope: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.changedPaths.map(change => change.path)).toEqual(["foo[1].ts"]);
  });

  it("excludes ignored paths from the candidate", async () => {
    const fixture = await initRepoAndWorktree({ ".gitignore": "ignored.txt\n", "a.txt": "hello\n" });
    await writeFile(join(fixture.worktreePath, "ignored.txt"), "ignored\n");

    const result = await freezeCandidate({
      ...fixture,
      runId: "run-ignored",
      writeAllowlist: ["**"],
      forbiddenScope: [],
    });

    expect(result).toEqual({ ok: false, reason: "empty-candidate" });
  });

  it("redacts secrets from the persisted review patch", async () => {
    const fixture = await initRepoAndWorktree();
    await writeFile(join(fixture.worktreePath, "a.txt"), "API_KEY=abcdef123456\n");

    const result = await freezeCandidate({
      ...fixture,
      runId: "run-redaction",
      writeAllowlist: ["a.txt"],
      forbiddenScope: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.patch).toContain("«redacted:env»");
      expect(result.artifact.patch).not.toContain("abcdef123456");
    }
  });
});
