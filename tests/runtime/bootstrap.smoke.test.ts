import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const temporaryPaths: string[] = [];
const bootstrapPath = fileURLToPath(new URL("../../runtime/bootstrap.mjs", import.meta.url));

async function fakeServer(root: string): Promise<string> {
  const serverPath = path.join(root, "fake-server.mjs");
  await writeFile(
    serverPath,
    "console.error('fake server ready'); export async function start() {}\n",
  );
  return serverPath;
}

async function oldNodePrelude(root: string): Promise<string> {
  const preludePath = path.join(root, "old-node.mjs");
  await writeFile(
    preludePath,
    "Object.defineProperty(process.versions, 'node', { value: '20.19.0' });\n",
  );
  return preludePath;
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(entry =>
    rm(entry, { recursive: true, force: true })));
});

describe("runtime bootstrap", () => {
  it("starts the server on a supported runtime without writing protocol noise to stdout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ca-bootstrap-supported-"));
    temporaryPaths.push(root);
    const serverPath = await fakeServer(root);

    const result = spawnSync(process.execPath, [bootstrapPath], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_ARCHITECT_SERVER_PATH: serverPath },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("fake server ready");
  });

  it.skipIf(process.platform === "win32")("re-execs a supported node found on PATH", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ca-bootstrap-reexec-"));
    temporaryPaths.push(root);
    const serverPath = await fakeServer(root);
    const preludePath = await oldNodePrelude(root);
    const bin = path.join(root, "bin");
    await mkdir(bin);
    await symlink(process.execPath, path.join(bin, "node"));

    const result = spawnSync(
      process.execPath,
      ["--import", preludePath, bootstrapPath],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: bin,
          CLAUDE_ARCHITECT_SERVER_PATH: serverPath,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("fake server ready");
  });

  it("fails on stderr when no supported node exists on PATH", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ca-bootstrap-missing-"));
    temporaryPaths.push(root);
    const preludePath = await oldNodePrelude(root);
    const emptyBin = path.join(root, "empty-bin");
    await mkdir(emptyBin);

    const result = spawnSync(
      process.execPath,
      ["--import", preludePath, bootstrapPath],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: emptyBin },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Node.js 22");
    expect(result.stderr).toContain("PATH");
  });
});
