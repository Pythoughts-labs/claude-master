import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git } from "../../src/git/git-exec.js";
import {
  composeSliceOntoHead,
  parseRawDiffEntries,
} from "../../src/pipeline/slice-composer.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function run(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function initRepo(): Promise<{ directory: string; base: string }> {
  const directory = await mkdtemp(join(tmpdir(), "ca-compose-repo-"));
  temporaryPaths.push(directory);
  await run(directory, ["init", "-q"]);
  await writeFile(join(directory, "keep.txt"), "base\n");
  await writeFile(join(directory, "doomed.txt"), "delete me\n");
  await run(directory, ["add", "-A"]);
  await run(directory, ["commit", "-q", "-m", "base"]);
  return { directory, base: await run(directory, ["rev-parse", "HEAD"]) };
}

/** Commit a set of edits on top of `parent` without disturbing the checkout. */
async function commitOnto(
  directory: string,
  parent: string,
  edits: Record<string, string | null>,
  afterEdits?: (worktree: string) => Promise<void>,
): Promise<string> {
  const worktree = await mkdtemp(join(tmpdir(), "ca-compose-wt-"));
  temporaryPaths.push(worktree);
  await run(directory, ["worktree", "add", "-q", "--detach", worktree, parent]);
  try {
    for (const [file, contents] of Object.entries(edits)) {
      if (contents === null) await rm(join(worktree, file), { force: true });
      else await writeFile(join(worktree, file), contents);
    }
    await afterEdits?.(worktree);
    await run(worktree, ["add", "-A"]);
    await run(worktree, ["commit", "-q", "-m", `edit ${Object.keys(edits).join(",")}`]);
    return await run(worktree, ["rev-parse", "HEAD"]);
  } finally {
    await run(directory, ["worktree", "remove", "--force", worktree]);
  }
}

describe("slice composition", () => {
  it("parses added, modified, and deleted entries from a raw diff", () => {
    const raw = ":000000 100644 0000000000000000000000000000000000000000 aaa A\0added.ts\0"
      + ":100644 100644 bbb ccc M\0changed.ts\0"
      + ":100644 000000 ddd 0000000000000000000000000000000000000000 D\0gone.ts\0";

    expect(parseRawDiffEntries(raw)).toEqual([
      { path: "added.ts", mode: "100644", oid: "aaa", deleted: false },
      { path: "changed.ts", mode: "100644", oid: "ccc", deleted: false },
      { path: "gone.ts", mode: "000000", oid: "0000000000000000000000000000000000000000", deleted: true },
    ]);
  });

  it("returns the slice commit untouched when nothing has been composed yet", async () => {
    const { directory, base } = await initRepo();
    const slice = await commitOnto(directory, base, { "a.txt": "a\n" });

    await expect(composeSliceOntoHead({
      checkoutPath: directory,
      head: base,
      base,
      sliceCommit: slice,
      sliceIndex: 1,
      runId: "run",
    })).resolves.toBe(slice);
  });

  it("produces the same tree as applying the slices sequentially", async () => {
    // The anchor for the whole parallel path: composing independent slices by
    // union must be indistinguishable from having run them one after another.
    const { directory, base } = await initRepo();
    const first = await commitOnto(directory, base, { "a.txt": "from slice one\n" });
    const second = await commitOnto(directory, base, {
      "b.txt": "from slice two\n",
      "doomed.txt": null,
    });
    const sequential = await commitOnto(directory, first, {
      "b.txt": "from slice two\n",
      "doomed.txt": null,
    });

    const composed = await composeSliceOntoHead({
      checkoutPath: directory,
      head: first,
      base,
      sliceCommit: second,
      sliceIndex: 2,
      runId: "run",
    });

    expect(await run(directory, ["rev-parse", `${composed}^{tree}`]))
      .toBe(await run(directory, ["rev-parse", `${sequential}^{tree}`]));
    expect(await run(directory, ["rev-parse", `${composed}^`])).toBe(first);
  });

  it("preserves an executable mode through composition", async () => {
    const { directory, base } = await initRepo();
    const first = await commitOnto(directory, base, { "a.txt": "one\n" });
    const second = await commitOnto(
      directory,
      base,
      { "tool.sh": "#!/bin/sh\n" },
      async worktree => { await chmod(join(worktree, "tool.sh"), 0o755); },
    );

    const composed = await composeSliceOntoHead({
      checkoutPath: directory,
      head: first,
      base,
      sliceCommit: second,
      sliceIndex: 2,
      runId: "run",
    });

    const listed = await run(directory, ["ls-tree", composed, "tool.sh"]);
    const sliceListed = await run(directory, ["ls-tree", second, "tool.sh"]);
    expect(listed.split(/\s+/u)[0]).toBe(sliceListed.split(/\s+/u)[0]);
  });

  it("refuses to compose slices that touched the same path", async () => {
    // Scheduling promised this could not happen; if it does, confinement broke
    // upstream and silently picking a winner would hide it.
    const { directory, base } = await initRepo();
    const first = await commitOnto(directory, base, { "shared.txt": "one\n" });
    const second = await commitOnto(directory, base, { "shared.txt": "two\n" });

    await expect(composeSliceOntoHead({
      checkoutPath: directory,
      head: first,
      base,
      sliceCommit: second,
      sliceIndex: 2,
      runId: "run",
    })).rejects.toThrow("already written by its wave");
  });

  it("carries a deletion into the composed tree", async () => {
    const { directory, base } = await initRepo();
    const first = await commitOnto(directory, base, { "a.txt": "one\n" });
    const second = await commitOnto(directory, base, { "doomed.txt": null });

    const composed = await composeSliceOntoHead({
      checkoutPath: directory,
      head: first,
      base,
      sliceCommit: second,
      sliceIndex: 2,
      runId: "run",
    });

    expect(await run(directory, ["ls-tree", "--name-only", composed]).then(out => out.split("\n")))
      .toEqual(["a.txt", "keep.txt"]);
  });
});
