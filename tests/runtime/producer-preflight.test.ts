import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PosixPlatformServices } from "../../src/platform/posix-platform-services.js";
import { CodexAdapter } from "../../src/producers/codex-adapter.js";
import {
  PREFLIGHT_PROBE_FILE,
  preflightExecutables,
  preflightProbeCommand,
  readProbe,
  runProducerPreflight,
} from "../../src/runtime/producer-preflight.js";
import type { DelegationSpec } from "../../src/protocol/delegation-spec.js";

const execFileAsync = promisify(execFile);

function spec(executables: string[]): DelegationSpec {
  return {
    specVersion: "1",
    objective: "objective",
    context: "context",
    writeAllowlist: ["src/**"],
    forbiddenScope: [],
    successCriteria: ["done"],
    verification: executables.map((executable, index) => ({
      id: `check-${index}`,
      executable,
      args: ["--version"],
      cwd: ".",
      timeoutMs: 60_000,
      network: "denied" as const,
      expectedExitCodes: [0],
    })),
    executionMode: "edit",
    timeoutMs: 600_000,
    producerPreferences: ["codex"],
    expectedOutput: "candidate-patch",
  };
}

describe("producer preflight", () => {
  it("probes each distinct executable once, in a stable order", () => {
    expect(preflightExecutables(spec(["npx", "node", "npx"]))).toEqual(["node", "npx"]);
  });

  it("refuses to inline an executable that is not shell-safe", () => {
    // Independent verification still covers these; the probe must not become an
    // injection point for a path- or metacharacter-bearing name.
    expect(preflightExecutables(spec(["/usr/bin/node", "a;rm -rf /", "node"]))).toEqual(["node"]);
  });

  it("redirects every probe into the file the runtime reads", () => {
    const command = preflightProbeCommand(["node", "git"]);

    expect(command).toContain(`> ${PREFLIGHT_PROBE_FILE}`);
    expect(command).toContain("command -v node");
    expect(command).toContain("command -v git");
  });

  it("treats a resolved path as present", () => {
    expect(readProbe("node /usr/bin/node\ngit /usr/bin/git\n", ["node", "git"])).toEqual([]);
  });

  it("reports an executable the shell could not resolve", () => {
    expect(readProbe("node MISSING\ngit /usr/bin/git\n", ["node", "git"])).toEqual(["node"]);
  });

  it("reports an executable the probe never mentioned", () => {
    expect(readProbe("git /usr/bin/git\n", ["node", "git"])).toEqual(["node"]);
  });

  it("ignores shell noise around the probe lines", () => {
    const contents = [
      "/Users/someone/.zshenv:14: command not found: cat",
      "node /opt/node/bin/node",
      "",
      "git /usr/bin/git",
    ].join("\n");

    expect(readProbe(contents, ["node", "git"])).toEqual([]);
  });

  it("does not accept a bare name as a resolution", () => {
    // `command -v` printing nothing leaves the trailing name alone on the line;
    // that is a miss, not a hit.
    expect(readProbe("node \ngit /usr/bin/git", ["node", "git"])).toEqual(["node"]);
  });

  it.skipIf(
    process.platform === "win32"
      || process.env.RUN_CODEX_PREFLIGHT_GATE !== "1",
  )(
    "proves the probe runs in the Producer's own shell against real Codex",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "claude-architect-preflight-gate-"));
      const repoRoot = join(root, "repo");
      const tempHome = join(root, "home");
      const originalCodexHome = process.env.CODEX_HOME;
      if (originalCodexHome === undefined) {
        process.env.CODEX_HOME = join(process.env.HOME ?? "", ".codex");
      }
      try {
        await execFileAsync("mkdir", ["-p", repoRoot, tempHome]);
        await execFileAsync("git", ["init", "-q"], { cwd: repoRoot });
        await execFileAsync("git", ["commit", "-q", "--allow-empty", "-m", "base"], {
          cwd: repoRoot,
        });
        const baseCommitOid = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }))
          .stdout.trim();
        const ps = new PosixPlatformServices();
        const adapter = new CodexAdapter();
        const capabilityReport = await adapter.probe({
          ps,
          os: process.platform === "darwin" ? "darwin" : "linux",
          arch: process.arch,
          environmentType: "native",
        });
        expect(capabilityReport.resolvedExecutable).not.toBeNull();
        if (capabilityReport.resolvedExecutable === null) return;

        const resolvable = await runProducerPreflight({
          adapter,
          capabilityReport,
          spec: spec(["node", "git"]),
          repoRoot,
          baseCommitOid,
          runId: "preflight-gate-ok",
          ps,
          tempHome,
        });
        expect(resolvable.status, JSON.stringify(resolvable)).toBe("ok");

        // The discriminating half: an executable that genuinely is not there
        // must be reported, or a green probe means nothing.
        const absent = await runProducerPreflight({
          adapter,
          capabilityReport,
          spec: spec(["node", "definitely-not-installed-xyzzy"]),
          repoRoot,
          baseCommitOid,
          runId: "preflight-gate-missing",
          ps,
          tempHome,
        });
        expect(absent.status, JSON.stringify(absent)).toBe("environment-defect");
        expect(absent.missing).toEqual(["definitely-not-installed-xyzzy"]);
      } finally {
        if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = originalCodexHome;
        await rm(root, { recursive: true, force: true });
      }
    },
    420_000,
  );
});
