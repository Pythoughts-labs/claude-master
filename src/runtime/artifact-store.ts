import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { AttemptResult } from "../protocol/attempt-result.js";
import { git } from "../git/git-exec.js";
import { RuntimeError } from "../util/errors.js";
import { redact, redactRecord } from "./redaction.js";
import type { RunManifest } from "./run-manifest.js";
import { resolveStateDir } from "./state-dir.js";

const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CANDIDATE_REF_PREFIX = "refs/claude-architect/candidates/";

export interface PrunePolicy {
  maxAgeMs: number;
  maxBytes: number;
}

export interface PruneResult {
  removed: string[];
  retained: Array<{ runId: string; reason: string }>;
}

interface RunEntry {
  runId: string;
  directory: string;
  modifiedAtMs: number;
  bytes: number;
}

function validateComponent(value: string, kind: "run id" | "log name"): void {
  if (!SAFE_COMPONENT.test(value) || value === "." || value === "..") {
    throw new RuntimeError(`invalid ${kind}: ${JSON.stringify(value)}`);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function validatePruneLimit(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RuntimeError(`invalid ${name}`);
  }
}

function compareEntries(left: RunEntry, right: RunEntry): number {
  if (left.modifiedAtMs !== right.modifiedAtMs) {
    return left.modifiedAtMs - right.modifiedAtMs;
  }
  return left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0;
}

async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(entryPath);
    else if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
}

export class ArtifactStore {
  readonly runDirectory: string;
  private readonly runsRoot: string;
  private readonly runId: string;

  constructor(runId: string) {
    validateComponent(runId, "run id");
    this.runId = runId;
    this.runsRoot = path.join(resolveStateDir(), "runs");
    this.runDirectory = path.join(this.runsRoot, runId);
  }

  private async writeArchiveFile(relativePath: string, text: string): Promise<void> {
    const destination = path.join(this.runDirectory, relativePath);
    const directory = path.dirname(destination);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(directory, `.${path.basename(destination)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporaryPath, destination);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async writeJson(relativePath: string, value: unknown): Promise<void> {
    const sanitized = redactRecord(value);
    await this.writeArchiveFile(relativePath, `${JSON.stringify(sanitized, null, 2)}\n`);
  }

  async writeLog(name: string, text: string): Promise<string> {
    validateComponent(name, "log name");
    const ref = path.posix.join("logs", `${name}.log`);
    await this.writeArchiveFile(ref, redact(text));
    return ref;
  }

  async writeResult(result: AttemptResult): Promise<void> {
    if (result.runId !== this.runId) {
      throw new RuntimeError("attempt result run id does not match artifact store");
    }
    await this.writeJson("result.json", result);
  }

  async writeManifest(manifest: RunManifest): Promise<void> {
    if (manifest.runId !== this.runId) {
      throw new RuntimeError("run manifest id does not match artifact store");
    }
    await this.writeJson("manifest.json", manifest);
  }

  async readResult(runId: string): Promise<AttemptResult | null> {
    validateComponent(runId, "run id");
    try {
      const text = await readFile(path.join(this.runsRoot, runId, "result.json"), "utf8");
      return JSON.parse(text) as AttemptResult;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async readManifest(runId: string): Promise<RunManifest | null> {
    try {
      const text = await readFile(path.join(this.runsRoot, runId, "manifest.json"), "utf8");
      return JSON.parse(text) as RunManifest;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async list(): Promise<string[]> {
    await mkdir(this.runsRoot, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.runsRoot, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && SAFE_COMPONENT.test(entry.name))
      .map(entry => entry.name)
      .sort();
  }

  private async entries(): Promise<RunEntry[]> {
    const entries = await Promise.all((await this.list()).map(async runId => {
      const directory = path.join(this.runsRoot, runId);
      const metadata = await stat(directory);
      return {
        runId,
        directory,
        modifiedAtMs: metadata.mtimeMs,
        bytes: await directoryBytes(directory),
      };
    }));
    return entries.sort(compareEntries);
  }

  private async deleteCandidateAnchor(runId: string): Promise<void> {
    const result = await this.readResult(runId);
    if (result?.candidate === null || result?.candidate === undefined) return;

    const expectedRef = `${CANDIDATE_REF_PREFIX}${runId}`;
    if (result.candidate.anchorRef !== expectedRef) {
      throw new RuntimeError("archived candidate anchor does not match run id");
    }
    const manifest = await this.readManifest(runId);
    if (manifest === null) {
      throw new RuntimeError("cannot remove candidate anchor without archived repository root");
    }
    const deletion = await git(manifest.repoRoot, ["update-ref", "-d", expectedRef]);
    if (deletion.exitCode !== 0) {
      const diagnostic = redact(deletion.stderr || deletion.stdout).trim().slice(0, 2_000);
      throw new RuntimeError(
        `failed to remove candidate anchor${diagnostic ? `: ${diagnostic}` : ""}`,
      );
    }
  }

  async prune(policy: PrunePolicy): Promise<PruneResult> {
    validatePruneLimit(policy.maxAgeMs, "maxAgeMs");
    validatePruneLimit(policy.maxBytes, "maxBytes");

    const entries = await this.entries();
    const removed = new Set<string>();
    const attempted = new Set<string>();
    const retained: PruneResult["retained"] = [];
    let retainedBytes = entries.reduce((total, entry) => total + entry.bytes, 0);

    const removeEntry = async (entry: RunEntry): Promise<void> => {
      if (attempted.has(entry.runId)) return;
      attempted.add(entry.runId);
      try {
        await this.deleteCandidateAnchor(entry.runId);
        await rm(entry.directory, { recursive: true, force: true });
        removed.add(entry.runId);
        retainedBytes -= entry.bytes;
      } catch (error) {
        retained.push({
          runId: entry.runId,
          reason: redact(error instanceof Error ? error.message : String(error)),
        });
      }
    };

    const now = Date.now();
    for (const entry of entries) {
      if (now - entry.modifiedAtMs > policy.maxAgeMs) await removeEntry(entry);
    }
    for (const entry of entries) {
      if (retainedBytes <= policy.maxBytes) break;
      await removeEntry(entry);
    }

    return { removed: [...removed], retained };
  }
}
