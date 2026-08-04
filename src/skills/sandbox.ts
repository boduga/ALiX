/**
 * sandbox.ts — TEMPORARY STUB for the Layer-4 runtime isolation runner.
 *
 * Task 6 replaces this body with the full sandbox (Linux `unshare -Un` network
 * namespace isolation, filtered env, temp HOME, timeout). This stub exists so
 * `alix skills run` compiles and runs in the interim: it spawns the command
 * with a filtered environment and a temp HOME, captures stdout/stderr, and
 * kills on timeout, but reports networkIsolated: false (env-only isolation).
 *
 * The exported types and `runSandboxed` signature are fixed by Task 6 — do not
 * change them here.
 *
 * @module
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 1_000_000;

export interface SandboxRunOptions {
  /** Extra arguments appended to the command. */
  args?: string[];
  /** Working directory (default: fresh temp dir). */
  cwd?: string;
  /** Kill after this many ms (default 30000). */
  timeoutMs?: number;
  /** Attempt network isolation (default true). */
  noNetwork?: boolean;
  /** Extra environment variables layered over the filtered base. */
  env?: Record<string, string>;
  /** stdout/stderr capture cap in bytes (default 1MB). */
  maxBuffer?: number;
}

export interface SandboxRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** true when a network namespace was successfully created. */
  networkIsolated: boolean;
  usedCwd: string;
}

/** Filtered base environment: PATH preserved, HOME/TMPDIR point at the sandbox. */
function baseEnv(sandboxHome: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: sandboxHome,
    TMPDIR: sandboxHome,
    // Best-effort proxy-level network blocking even without a namespace.
    http_proxy: "",
    https_proxy: "",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
  };
}

/** Run a command once, capturing stdout/stderr with a timeout kill. */
function spawnOnce(
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  maxBuffer: number,
): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(argv[0], argv.slice(1), { cwd, env });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBuffer) stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBuffer) stderr += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr, exitCode: null, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: (code ?? -1) === 0, stdout, stderr, exitCode: code, timedOut });
    });
  });
}

/**
 * Stub implementation. Task 6 adds unshare-based network-namespace isolation;
 * today this runs the command with env-only isolation (networkIsolated: false).
 */
export async function runSandboxed(command: string, opts: SandboxRunOptions = {}): Promise<SandboxRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = opts.maxBuffer ?? MAX_BUFFER_BYTES;
  const args = opts.args ?? [];

  const sandboxHome = await mkdtemp(join(tmpdir(), "alix-sandbox-"));
  const usedCwd = opts.cwd ?? sandboxHome;
  const env = { ...baseEnv(sandboxHome), ...opts.env };

  try {
    const out = await spawnOnce([command, ...args], usedCwd, env, timeoutMs, maxBuffer);
    return {
      ok: out.ok,
      stdout: out.stdout,
      stderr: out.stderr,
      exitCode: out.exitCode,
      timedOut: out.timedOut,
      networkIsolated: false,
      usedCwd,
    };
  } finally {
    await rm(sandboxHome, { recursive: true, force: true });
  }
}
