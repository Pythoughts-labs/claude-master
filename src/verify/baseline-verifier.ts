import { randomUUID } from "node:crypto";
import { WorktreeManager } from "../git/worktree-manager.js";
import type { PlatformServices } from "../platform/platform-services.js";
import { getPlatformServices } from "../platform/select-platform.js";
import type { VerificationCommand } from "../protocol/delegation-spec.js";
import { appliesToPlatform, executeCommand, resolveCommandCwd } from "./project-verifier.js";

export interface BaselineCommandResult {
  id: string;
  exitCode: number | null;
  ok: boolean;
}

export interface BaselineReport {
  baselineCommitOid: string;
  commands: BaselineCommandResult[];
}

export interface BaselineVerifyArgs {
  repoRoot: string;
  headCommitOid: string;
  commands: VerificationCommand[];
  ps?: PlatformServices;
  arch?: string;
  now?: () => number;
  verificationId?: () => string;
}

export async function verifyBaseline(args: BaselineVerifyArgs): Promise<BaselineReport> {
  const ps = args.ps ?? getPlatformServices();
  const arch = args.arch ?? process.arch;
  const now = args.now ?? Date.now;
  const manager = new WorktreeManager(
    args.repoRoot,
    `baseline-${args.verificationId?.() ?? randomUUID()}`,
    ps,
  );
  const materialized = await manager.create(args.headCommitOid);
  let primaryError: unknown;
  try {
    const commands: BaselineCommandResult[] = [];
    for (let index = 0; index < args.commands.length; index += 1) {
      const command = args.commands[index]!;
      if (!appliesToPlatform(command, ps.os, arch).applies) {
        commands.push({ id: command.id, exitCode: null, ok: true });
        continue;
      }
      const cwd = await resolveCommandCwd(materialized.path, command.cwd, ps.os);
      if (cwd === null) {
        commands.push({ id: command.id, exitCode: null, ok: false });
        continue;
      }
      const executed = await executeCommand({ command, index, cwd, ps, now });
      commands.push({
        id: executed.outcome.id,
        exitCode: executed.outcome.exitCode,
        ok: !executed.failed,
      });
    }
    return { baselineCommitOid: args.headCommitOid, commands };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await materialized.cleanup();
    } catch (cleanupError) {
      if (primaryError === undefined) throw cleanupError;
      throw new AggregateError(
        [primaryError, cleanupError],
        "baseline verification failed and its worktree could not be cleaned up",
      );
    }
  }
}
