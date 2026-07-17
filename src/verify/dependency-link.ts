import { access, readFile, symlink } from "node:fs/promises";
import path from "node:path";

export type DependencyLink = "inherited" | "skipped-lockfile-mismatch" | "none";

const LOCKFILES = ["package-lock.json", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"] as const;

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function linkPrimaryDependencies(
  primaryRepo: string,
  worktreePath: string,
): Promise<DependencyLink> {
  const primaryModules = path.join(primaryRepo, "node_modules");
  if (!await exists(primaryModules)) return "none";

  let selected: string | undefined;
  for (const lockfile of LOCKFILES) {
    if (await exists(path.join(primaryRepo, lockfile))) {
      selected = lockfile;
      break;
    }
  }
  if (selected === undefined) return "none";

  try {
    const [primaryLock, worktreeLock] = await Promise.all([
      readFile(path.join(primaryRepo, selected)),
      readFile(path.join(worktreePath, selected)),
    ]);
    if (!primaryLock.equals(worktreeLock)) return "skipped-lockfile-mismatch";
  } catch {
    return "skipped-lockfile-mismatch";
  }

  await symlink(primaryModules, path.join(worktreePath, "node_modules"), "junction");
  return "inherited";
}
