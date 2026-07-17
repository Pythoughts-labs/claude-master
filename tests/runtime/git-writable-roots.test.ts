import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git } from "../../src/git/git-exec.js";
import { resolveLinkedWorktreeWritableRoots } from "../../src/pipeline/git-writable-roots.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(candidate =>
    rm(candidate, { recursive: true, force: true })));
});

describe("resolveLinkedWorktreeWritableRoots", () => {
  it("resolves the private gitdir and shared objects directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ca-git-roots-"));
    temporaryPaths.push(root);
    const repo = path.join(root, "repo");
    const linked = path.join(root, "linked");
    await mkdir(repo);
    expect((await git(repo, ["init", "-q"])).exitCode).toBe(0);
    await writeFile(path.join(repo, "a.txt"), "a\n");
    expect((await git(repo, ["add", "a.txt"])).exitCode).toBe(0);
    expect((await git(repo, ["commit", "-q", "-m", "initial"])).exitCode).toBe(0);
    expect((await git(repo, ["worktree", "add", "--detach", "-q", linked, "HEAD"])).exitCode).toBe(0);

    const privateGitDir = (await git(linked, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
    const commonGitDir = (await git(linked, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
    await expect(resolveLinkedWorktreeWritableRoots(linked)).resolves.toEqual([
      privateGitDir,
      path.join(commonGitDir, "objects"),
    ]);
  });
});
