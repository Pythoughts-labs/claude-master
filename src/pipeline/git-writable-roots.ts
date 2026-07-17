import { readFile } from "node:fs/promises";
import path from "node:path";

export async function resolveLinkedWorktreeWritableRoots(
  worktreePath: string,
): Promise<string[]> {
  const dotGit = path.join(worktreePath, ".git");
  let pointer: string;
  try {
    pointer = await readFile(dotGit, "utf8");
  } catch {
    return [];
  }
  const match = /^gitdir: (.+)\r?\n?$/.exec(pointer);
  if (match === null) return [];

  const gitDir = path.resolve(worktreePath, match[1]!);
  const commonDirValue = (await readFile(path.join(gitDir, "commondir"), "utf8")).trim();
  const commonDir = path.resolve(gitDir, commonDirValue);
  return [gitDir, path.join(commonDir, "objects")];
}
