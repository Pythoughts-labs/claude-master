import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AttemptResult } from "../../src/protocol/attempt-result.js";
import { ArtifactStore } from "../../src/runtime/artifact-store.js";
import {
  buildRunManifest,
  type BuildRunManifestArgs,
} from "../../src/runtime/run-manifest.js";
import {
  clearRegisteredSecrets,
  registerSecretValue,
} from "../../src/runtime/redaction.js";

const execFileAsync = promisify(execFile);
const temporaryPaths: string[] = [];
let previousPluginData: string | undefined;
let previousPluginRoot: string | undefined;

function sampleResult(runId: string): AttemptResult {
  return {
    resultVersion: "1",
    runId,
    status: "failed",
    failure: "producer-failure",
    summary: "producer exited non-zero",
    producerSummary: null,
    candidate: null,
    requestedVerification: [],
    executedVerification: [],
    unresolvedIssues: [],
    evidence: {},
    logsRef: "logs/producer.log",
    producerId: "codex",
    producerVersion: "1.2.3",
    producerModel: null,
    durationMs: 42,
    sessionId: null,
  };
}

function manifestArgs(runId: string, repoRoot: string): BuildRunManifestArgs {
  return {
    runId,
    repoRoot,
    baseCommitOid: "a".repeat(40),
    candidateManifestHash: null,
    producer: { id: "codex", version: "1.2.3", model: null },
    effectivePolicy: { isolation: "temporary-home", retries: 0 },
    repositoryInstructions: [
      { path: "AGENTS.md", content: "follow the repository rules\n" },
    ],
    prompt: "Implement the requested change",
    executionPolicy: { network: "denied", writeAllowlist: ["src/**"] },
    environment: [
      { name: "PATH", source: "platform" },
      { name: "CODEX_TOKEN", source: "adapter" },
    ],
    packagedVerifier: { version: "1", content: "trusted verifier bytes" },
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  });
  return result.stdout.trim();
}

beforeEach(async () => {
  previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  previousPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const stateRoot = await mkdtemp(join(tmpdir(), "claude-architect-artifacts-"));
  temporaryPaths.push(stateRoot);
  process.env.CLAUDE_PLUGIN_DATA = stateRoot;
  process.env.CLAUDE_PLUGIN_ROOT = join(stateRoot, "plugin-cache");
  clearRegisteredSecrets();
});

afterEach(async () => {
  if (previousPluginData === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
  else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
  if (previousPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
  else process.env.CLAUDE_PLUGIN_ROOT = previousPluginRoot;
  clearRegisteredSecrets();
  await Promise.all(temporaryPaths.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("ArtifactStore", () => {
  it("round-trips an AttemptResult under plugin data", async () => {
    const store = new ArtifactStore("run-round-trip");
    const result = sampleResult("run-round-trip");

    await store.writeResult(result);

    await expect(store.readResult("run-round-trip")).resolves.toEqual(result);
    await expect(store.list()).resolves.toContain("run-round-trip");
    await expect(access(join(
      process.env.CLAUDE_PLUGIN_DATA!,
      "runs",
      "run-round-trip",
      "result.json",
    ))).resolves.toBeUndefined();
    await expect(access(join(process.env.CLAUDE_PLUGIN_ROOT!, "runs"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("writes redacted logs and returns a relative archive ref", async () => {
    const registration = registerSecretValue("enterprise-secret-value");
    const store = new ArtifactStore("run-log");

    const ref = await store.writeLog("producer", "output enterprise-secret-value\n");

    expect(ref).toBe("logs/producer.log");
    const stored = await readFile(join(process.env.CLAUDE_PLUGIN_DATA!, "runs", "run-log", ref), "utf8");
    expect(stored).not.toContain("enterprise-secret-value");
    expect(stored).toContain("«redacted:secret»");
    registration.dispose();
  });

  it("rejects path traversal in run and log names", async () => {
    expect(() => new ArtifactStore("../outside")).toThrow(/invalid run id/);
    const store = new ArtifactStore("run-safe");

    await expect(store.writeLog("../outside", "text")).rejects.toThrow(/invalid log name/);
  });

  it("prunes over-age runs", async () => {
    const oldStore = new ArtifactStore("run-old");
    await oldStore.writeResult(sampleResult("run-old"));
    const oldDirectory = join(process.env.CLAUDE_PLUGIN_DATA!, "runs", "run-old");
    const oldTime = new Date(Date.now() - 60_000);
    await utimes(oldDirectory, oldTime, oldTime);

    const result = await oldStore.prune({ maxAgeMs: 1_000, maxBytes: Number.MAX_SAFE_INTEGER });

    expect(result.removed).toContain("run-old");
    await expect(stat(oldDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("enforces the byte limit", async () => {
    const store = new ArtifactStore("run-large");
    await store.writeResult(sampleResult("run-large"));
    await store.writeLog("large", "x".repeat(1_000));

    const result = await store.prune({ maxAgeMs: Number.MAX_SAFE_INTEGER, maxBytes: 0 });

    expect(result.removed).toContain("run-large");
  });

  it("deletes a candidate anchor before pruning its archive", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "claude-architect-prune-repo-"));
    temporaryPaths.push(repoRoot);
    await git(repoRoot, ["init", "-q"]);
    await git(repoRoot, ["commit", "--allow-empty", "-q", "-m", "base"]);
    const commitOid = await git(repoRoot, ["rev-parse", "HEAD"]);
    const anchorRef = "refs/claude-architect/candidates/run-anchor";
    await git(repoRoot, ["update-ref", anchorRef, commitOid]);

    const store = new ArtifactStore("run-anchor");
    const result = sampleResult("run-anchor");
    result.candidate = {
      baseCommitOid: commitOid,
      candidateTreeOid: await git(repoRoot, ["rev-parse", "HEAD^{tree}"]),
      candidateCommitOid: commitOid,
      anchorRef,
      manifestHash: createHash("sha256").update("[]").digest("hex"),
      changedPaths: [],
      patch: "",
    };
    await store.writeResult(result);
    await store.writeManifest(buildRunManifest(manifestArgs("run-anchor", repoRoot)));
    const runDirectory = join(process.env.CLAUDE_PLUGIN_DATA!, "runs", "run-anchor");
    const oldTime = new Date(Date.now() - 60_000);
    await utimes(runDirectory, oldTime, oldTime);

    await store.prune({ maxAgeMs: 1_000, maxBytes: Number.MAX_SAFE_INTEGER });

    await expect(git(repoRoot, ["show-ref", "--verify", anchorRef])).rejects.toBeDefined();
    await expect(stat(runDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("buildRunManifest", () => {
  it("records reproducibility hashes and names-only environment provenance", () => {
    const registration = registerSecretValue("manifest-secret-value");
    const args = manifestArgs("run-manifest", "/canonical/repo");
    args.effectivePolicy = {
      token: "manifest-secret-value",
      nested: { beta: 2, alpha: 1 },
    };

    const manifest = buildRunManifest(args);
    const reordered = buildRunManifest({
      ...args,
      effectivePolicy: {
        nested: { alpha: 1, beta: 2 },
        token: "manifest-secret-value",
      },
    });

    expect(manifest.promptHash).toBe(
      createHash("sha256").update(args.prompt).digest("hex"),
    );
    expect(manifest.repositoryInstructions).toEqual([
      {
        path: "AGENTS.md",
        hash: createHash("sha256")
          .update("follow the repository rules\n")
          .digest("hex"),
      },
    ]);
    expect(manifest.packagedVerifier.hash).toBe(
      createHash("sha256").update("trusted verifier bytes").digest("hex"),
    );
    expect(manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.manifestHash).toBe(reordered.manifestHash);
    expect(JSON.stringify(manifest)).not.toContain("manifest-secret-value");
    expect(manifest.environment).toEqual(args.environment);
    registration.dispose();
  });
});
