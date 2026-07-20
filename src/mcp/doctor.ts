import { constants } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import path from "node:path";
import nodeProcess from "node:process";
import { git as runGit } from "../git/git-exec.js";
import type { PlatformServices } from "../platform/platform-services.js";
import { CLEANUP_JOURNAL_LOCK_KEY } from "../platform/posix-platform-services.js";
import { SANDBOX_BACKENDS } from "../platform/sandbox/backends.js";
import { getPlatformServices } from "../platform/select-platform.js";
import { probeAll as probeProducers } from "../producers/capability-probe.js";
import {
  detectEnvironmentType,
  type CapabilityReport,
  type EnvironmentType,
} from "../producers/producer-adapter.js";
import {
  DELEGATION_SPEC_VERSION,
  PROTOCOL_VERSION,
  RUNTIME_VERSION,
} from "../protocol/versions.js";
import { redact, redactRecord } from "../runtime/redaction.js";
import { probeCowSupport } from "../verify/dependency-link.js";

const POSIX_HOME_PATH = /\/(?:Users|home)\/[^/\\\s"']+(?:\/[^/\\\s"']+)*/g;
const WINDOWS_HOME_PATH = /[A-Za-z]:\\Users\\[^/\\\s"']+(?:\\[^/\\\s"']+)*/gi;
const CHECKOUT_LOCK_NAME = /^([0-9a-f]{64})\.lock$/;
const MAX_CHECKOUT_LOCK_BYTES = 4_096;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

interface CheckoutLockOwner {
  pid: number;
  processToken: string | null;
}

function redactAbsoluteHomePaths(text: string): string {
  return redact(text)
    .replace(WINDOWS_HOME_PATH, match => `[path]\\${match.split("\\").at(-1) ?? ""}`)
    .replace(POSIX_HOME_PATH, match => `[path]/${match.split("/").at(-1) ?? ""}`);
}

function sanitizeDoctorValue(value: unknown): unknown {
  if (typeof value === "string") return redactAbsoluteHomePaths(value);
  if (Array.isArray(value)) return value.map(sanitizeDoctorValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sanitizeDoctorValue(child),
  ]));
}

function sanitizeCapabilityReports(reports: CapabilityReport[]): CapabilityReport[] {
  return sanitizeDoctorValue(redactRecord(reports)) as CapabilityReport[];
}

export interface DoctorResult {
  node: { version: string; ok: boolean };
  git: { version: string | null; ok: boolean };
  producers: CapabilityReport[];
  sandboxBackends: Array<{
    id: string;
    kind: string;
    state: "certified" | "tested" | "unsupported";
  }>;
  dependencyClone: { cowSupported: boolean; strategy: string };
  runtimeVersion: string;
  schemaVersion: string;
  protocolVersion: string;
  issues: string[];
}

export interface DoctorDependencies {
  ps?: PlatformServices;
  git?: typeof runGit;
  probeAll?: typeof probeProducers;
  probeCowSupport?: typeof probeCowSupport;
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  arch?: string;
  environmentType?: EnvironmentType;
  isProcessAlive?: (pid: number) => boolean;
}

function nodeIsSupported(version: string): boolean {
  const major = Number.parseInt(version.split(".", 1)[0] ?? "", 10);
  return Number.isInteger(major) && major >= 22;
}

function gitVersion(stdout: string): string | null {
  return /^git version ([^\s]+)(?:\s|$)/u.exec(stdout.trim())?.[1] ?? null;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    nodeProcess.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "EPERM") return true;
    if (errorCode(error) === "ESRCH") return false;
    throw error;
  }
}

function parseCheckoutLockOwner(contents: string): CheckoutLockOwner | null {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const owner = value as { pid?: unknown; processToken?: unknown };
  const processToken = owner.processToken;
  if (typeof owner.pid !== "number" || !Number.isSafeInteger(owner.pid) || owner.pid < 1
    || (processToken !== null
      && (typeof processToken !== "string" || processToken.length === 0))) {
    return null;
  }
  return { pid: owner.pid, processToken };
}

async function readCheckoutLock(handle: FileHandle): Promise<string | null> {
  const buffer = Buffer.alloc(MAX_CHECKOUT_LOCK_BYTES + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset > MAX_CHECKOUT_LOCK_BYTES
    ? null
    : buffer.subarray(0, offset).toString("utf8");
}

async function checkoutLockIssues(
  stateDir: string | undefined,
  ps: PlatformServices,
  isProcessAlive: (pid: number) => boolean,
): Promise<string[]> {
  if (stateDir === undefined) return [];
  const locksRoot = path.join(stateDir, "locks");
  let entries;
  try {
    entries = await readdir(locksRoot, { withFileTypes: true });
  } catch (error) {
    return errorCode(error) === "ENOENT" ? [] : ["checkout-lock-scan-failed"];
  }

  const issues = new Set<string>();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const match = CHECKOUT_LOCK_NAME.exec(entry.name);
    if (match === null || match[1] === CLEANUP_JOURNAL_LOCK_KEY) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      issues.add("checkout-lock-malformed");
      continue;
    }

    let handle;
    try {
      handle = await open(path.join(locksRoot, entry.name), constants.O_RDONLY | NO_FOLLOW);
      const metadataBeforeRead = await handle.stat();
      if (!metadataBeforeRead.isFile() || metadataBeforeRead.size > MAX_CHECKOUT_LOCK_BYTES) {
        issues.add("checkout-lock-malformed");
        continue;
      }
      const contents = await readCheckoutLock(handle);
      const metadataAfterRead = await handle.stat();
      if (contents === null
        || metadataAfterRead.size !== metadataBeforeRead.size
        || metadataAfterRead.mtimeMs !== metadataBeforeRead.mtimeMs
        || metadataAfterRead.ctimeMs !== metadataBeforeRead.ctimeMs) {
        issues.add("checkout-lock-malformed");
        continue;
      }
      const owner = parseCheckoutLockOwner(contents);
      if (owner === null) {
        issues.add("checkout-lock-malformed");
        continue;
      }
      if (!isProcessAlive(owner.pid)) {
        issues.add("checkout-lock-leaked");
        continue;
      }
      const liveToken = owner.processToken === null
        ? null
        : await ps.getProcessStartToken(owner.pid);
      issues.add(owner.processToken !== null
        && liveToken !== null
        && liveToken !== owner.processToken
        ? "checkout-lock-leaked"
        : "checkout-lock-held");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") issues.add("checkout-lock-malformed");
    } finally {
      try {
        await handle?.close();
      } catch {
        issues.add("checkout-lock-malformed");
      }
    }
  }
  return [...issues];
}

export async function doctor(deps: DoctorDependencies = {}): Promise<DoctorResult> {
  const ps = deps.ps ?? getPlatformServices();
  const env = deps.env ?? process.env;
  const nodeVersion = deps.nodeVersion ?? process.versions.node;
  const arch = deps.arch ?? process.arch;
  const environmentType = deps.environmentType ?? detectEnvironmentType();
  const issues: string[] = [];
  const sandboxBackends = SANDBOX_BACKENDS.map(backend => ({
    id: backend.id,
    kind: backend.kind,
    state: backend.platforms.find(candidate =>
      candidate.os === ps.os
      && candidate.environmentType === environmentType
      && (candidate.arch === undefined || candidate.arch === arch))?.state ?? "unsupported",
  }));

  const supportedNodeVersion = nodeIsSupported(nodeVersion);
  let initialNodeAvailable = false;
  try {
    await ps.resolveExecutable({ name: "node" });
    initialNodeAvailable = true;
  } catch {
    issues.push("initial-node-unavailable");
  }
  const node = { version: nodeVersion, ok: supportedNodeVersion && initialNodeAvailable };
  if (!supportedNodeVersion) issues.push("unsupported-node-version");
  if (!env.CLAUDE_PLUGIN_DATA) issues.push("missing-claude-plugin-data");
  if (env.CLAUDE_ARCHITECT_DELEGATED !== undefined) {
    issues.push("nested-delegation-marker-present");
  }
  const stateDir = env.CLAUDE_PLUGIN_DATA
    ?? (env.NODE_ENV === "test" ? env.CLAUDE_ARCHITECT_STATE_DIR : undefined);
  issues.push(...await checkoutLockIssues(
    stateDir,
    ps,
    deps.isProcessAlive ?? defaultIsProcessAlive,
  ));

  let git: DoctorResult["git"] = { version: null, ok: false };
  try {
    const result = await (deps.git ?? runGit)(process.cwd(), ["--version"]);
    const version = result.exitCode === 0 && result.truncated?.stdout !== true
      ? gitVersion(result.stdout)
      : null;
    git = { version, ok: version !== null };
  } catch {
    // The issue code below is the actionable diagnostic; external error text is not exposed.
  }
  if (!git.ok) issues.push("git-unavailable");

  let dependencyClone: DoctorResult["dependencyClone"];
  try {
    dependencyClone = await (deps.probeCowSupport ?? probeCowSupport)();
  } catch {
    dependencyClone = { cowSupported: false, strategy: "unsupported" };
    issues.push("dependency-clone-probe-failed");
  }

  let producers: CapabilityReport[] = [];
  try {
    producers = sanitizeCapabilityReports(await (deps.probeAll ?? probeProducers)({
      ps,
      os: ps.os,
      arch,
      environmentType,
    }));
    for (const producer of producers) {
      if (!producer.available && producer.reason !== null) {
        issues.push(redact(`producer:${producer.producerId}:${producer.reason}`));
      }
    }
  } catch {
    issues.push("producer-probe-failed");
  }

  return {
    node,
    git,
    producers,
    sandboxBackends,
    dependencyClone,
    runtimeVersion: RUNTIME_VERSION,
    schemaVersion: DELEGATION_SPEC_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    issues,
  };
}
