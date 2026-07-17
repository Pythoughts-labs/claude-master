import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { git } from "../../src/git/git-exec.js";
import { RUNTIME_VERSION } from "../../src/protocol/versions.js";
import { collectReproducibilityInputs } from "../../src/runtime/reproducibility.js";

const temporaryPaths: string[] = [];

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function initRepo(instructionContent?: string): Promise<{ repoRoot: string; baseCommitOid: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "ca-reproducibility-"));
  temporaryPaths.push(repoRoot);
  await runGit(repoRoot, ["init", "-q"]);
  await writeFile(join(repoRoot, "fixture.txt"), "fixture\n");
  if (instructionContent !== undefined) {
    await writeFile(join(repoRoot, "AGENTS.md"), instructionContent);
  }
  await runGit(repoRoot, ["add", "-A"]);
  await runGit(repoRoot, ["commit", "-q", "-m", "initial"]);
  return { repoRoot, baseCommitOid: await runGit(repoRoot, ["rev-parse", "HEAD"]) };
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(path =>
    rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

describe("collectReproducibilityInputs", () => {
  it("reads instruction content from the committed tree and verifier bytes from the runtime", async () => {
    const instructionContent = "# Instructions\nCommitted content only.\n";
    const { repoRoot, baseCommitOid } = await initRepo(instructionContent);
    await writeFile(join(repoRoot, "AGENTS.md"), "uncommitted replacement\n");

    const collected = await collectReproducibilityInputs(repoRoot, baseCommitOid);

    expect(collected.repositoryInstructions).toEqual([{
      path: "AGENTS.md",
      content: instructionContent,
    }]);
    expect(collected.packagedVerifier).toEqual({
      version: RUNTIME_VERSION,
      content: await readFile(
        fileURLToPath(new URL("../../src/verify/acceptance-verifier.ts", import.meta.url)),
        "utf8",
      ),
    });
  });

  it("returns an empty instruction list when the committed tree has no allowlisted files", async () => {
    const { repoRoot, baseCommitOid } = await initRepo();

    const collected = await collectReproducibilityInputs(repoRoot, baseCommitOid);

    expect(collected.repositoryInstructions).toEqual([]);
    expect(collected.packagedVerifier.content.length).toBeGreaterThan(0);
  });
});
