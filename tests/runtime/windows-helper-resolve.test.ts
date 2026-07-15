import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveJobKillHelper,
  WindowsPlatformServices,
} from "../../src/platform/windows-platform-services.js";

describe("Windows job helper resolution (all OSes)", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map(directory => fs.rm(directory, {
      recursive: true, force: true,
    })));
  });

  async function tempRoot(): Promise<string> {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "windows-helper-"));
    tempDirectories.push(directory);
    return directory;
  }

  it("resolves the architecture-specific helper path", () => {
    const root = path.join("root", "plugin");
    expect(resolveJobKillHelper(root, "x64").path).toBe(
      path.join(root, "native", "bin", "win32-job-kill-x64.exe"),
    );
  });

  it("reports whether the helper is available", async () => {
    const root = await tempRoot();
    const helper = resolveJobKillHelper(root, "x64");
    expect(await helper.checkAvailable()).toBe(false);

    await fs.mkdir(path.dirname(helper.path), { recursive: true });
    await fs.writeFile(helper.path, "fixture", { mode: 0o755 });
    expect(await helper.checkAvailable()).toBe(true);
  });

  it("fails closed before spawning when the helper is missing", async () => {
    const root = await tempRoot();
    const helper = resolveJobKillHelper(root, "x64");
    const services = new WindowsPlatformServices(root, "x64");
    const spawnAttempt = services.spawnSupervised({
      executable: {
        kind: "native",
        command: path.join(root, "must-not-be-spawned"),
        prefixArgs: [],
        resolvedFrom: "test",
      },
      args: [],
      cwd: root,
      env: {},
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    });

    await expect(spawnAttempt).rejects.toMatchObject({
      message: "windows process-tree helper missing",
      detail: { path: helper.path },
    });
  });
});
