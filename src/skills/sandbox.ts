/**
 * Layer 4 of skill safety: sandboxed script execution.
 *
 * Skill scripts are normally run by the agent through its shell tool with the
 * user's full environment. `runSandboxed` is the sanctioned isolated runner:
 *  - env: filtered to PATH + temp-dir HOME/TMPDIR + proxy-blocking vars
 *  - cwd: a fresh temp dir (or the caller's cwd)
 *  - timeout: kill on expiry (mirrors shell-tool.ts)
 *  - network: best-effort `unshare -Un` on Linux (user + network namespace);
 *    falls back to env-only blocking and reports networkIsolated=false, because
 *    real socket blocking without namespaces needs containers.
 *
 * This is defense-in-depth, not a jail: a script can still read the real
 * filesystem via absolute paths. Install-time scanning (Layers 1-3) is the
 * primary boundary.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 1_000_000;
const UNSHARE = "/usr/bin/unshare";
// Overridable for tests: point at a fake `unshare` to simulate syscall-level
// failure. Read lazily so tests can set it after importing the module.
const UNSHARE_ENV = "ALIX_UNSHARE";
// util-linux prints this to stderr and exits non-zero WITHOUT executing the
// command when the unshare() syscall fails (EPERM, user namespaces disabled /
// seccomp). Treat it as a start failure so we fall back to the plain spawn.
const UNSHARE_SYSCALL_FAILURE = /^unshare: unshare failed/;

export interface SandboxRunOptions {
  /** Extra args appended to the command. */
  args?: string[];
  /** Working directory (default: a fresh temp dir). */
  cwd?: string;
  /** Kill after this many ms (default 30000). */
  timeoutMs?: number;
  /** Attempt network isolation (default true). */
  noNetwork?: boolean;
  /**
   * When noNetwork is true but isolation cannot be established (unshare missing
   * or the unshare() syscall is blocked), do NOT fall back to the plain spawn:
   * return a start-failure result instead. Default false keeps the env-only
   * fallback, which is a defense-in-depth boundary, not a jail.
   */
  failClosedOnNetworkFailure?: boolean;
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
  /**
   * true when the caller requested network isolation (noNetwork) but it could
   * NOT be established — unshare missing, user namespaces disabled/seccomp, or
   * a non-Linux platform. Distinct from `networkIsolated: false`, which is also
   * set when isolation was never requested. Check this flag (or use
   * failClosedOnNetworkFailure) rather than inferring from networkIsolated.
   */
  networkIsolationFailed: boolean;
  usedCwd: string;
}

interface SpawnOutcome {
  started: boolean;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

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
    no_proxy: "*",
    NO_PROXY: "*",
  };
}

function spawnOnce(
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  maxBuffer: number,
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (outcome: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

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
      finish({ started: false, ok: false, stdout: "", stderr: "", exitCode: null, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ started: true, ok: (code ?? -1) === 0, stdout, stderr, exitCode: code, timedOut });
    });
  });
}

export async function runSandboxed(command: string, opts: SandboxRunOptions = {}): Promise<SandboxRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = opts.maxBuffer ?? MAX_BUFFER_BYTES;
  const noNetwork = opts.noNetwork ?? true;
  const failClosed = opts.failClosedOnNetworkFailure ?? false;
  const args = opts.args ?? [];

  const sandboxHome = await mkdtemp(join(tmpdir(), "alix-sandbox-"));
  const usedCwd = opts.cwd ?? sandboxHome;
  const env = { ...baseEnv(sandboxHome), ...opts.env };

  try {
    const unsharePath = process.env[UNSHARE_ENV] ?? UNSHARE;
    const unshareEligible = process.platform === "linux" && existsSync(unsharePath);
    // Set when isolation was requested (noNetwork) but could not be delivered.
    let isolationFailed = false;

    if (noNetwork && unshareEligible) {
      const out = await spawnOnce([unsharePath, "-Un", "--", command, ...args], usedCwd, env, timeoutMs, maxBuffer);
      if (out.started) {
        // The unshare process spawned but the unshare() syscall itself failed
        // (EPERM — user namespaces disabled/seccomp): the command never ran.
        // A `unshare: failed to execute ...` (exit 127, command not found AFTER
        // namespace creation) is a REAL result and must not fall back.
        const syscallFailed = out.exitCode !== 0 && UNSHARE_SYSCALL_FAILURE.test(out.stderr);
        if (!syscallFailed) {
          return {
            ok: out.ok,
            stdout: out.stdout,
            stderr: out.stderr,
            exitCode: out.exitCode,
            timedOut: out.timedOut,
            networkIsolated: true,
            networkIsolationFailed: false,
            usedCwd,
          };
        }
        // unshare() syscall failed — the requested boundary was not delivered.
        isolationFailed = true;
        if (failClosed) {
          return {
            ok: false,
            stdout: "",
            stderr:
              `network isolation unavailable (unshare failed): ${out.stderr.trim()}. ` +
              `failClosedOnNetworkFailure is set — refusing to run ${command} without the network boundary.`,
            exitCode: null,
            timedOut: false,
            networkIsolated: false,
            networkIsolationFailed: true,
            usedCwd,
          };
        }
      } else {
        // unshare failed to start (ENOENT/EPERM) — requested boundary not delivered.
        isolationFailed = true;
        if (failClosed) {
          return {
            ok: false,
            stdout: "",
            stderr: `network isolation unavailable (unshare failed to start) — refusing to run ${command} without the network boundary.`,
            exitCode: null,
            timedOut: false,
            networkIsolated: false,
            networkIsolationFailed: true,
            usedCwd,
          };
        }
      }
    } else {
      // Isolation not requested, or not available on this platform/binary.
      isolationFailed = noNetwork;
    }

    // Fallback (or direct) plain spawn with env-only proxy blocking.
    const plain = await spawnOnce([command, ...args], usedCwd, env, timeoutMs, maxBuffer);
    if (!plain.started) {
      return {
        ok: false,
        stdout: "",
        stderr: `failed to start: ${command}`,
        exitCode: null,
        timedOut: false,
        networkIsolated: false,
        networkIsolationFailed: isolationFailed,
        usedCwd,
      };
    }
    return {
      ok: plain.ok,
      stdout: plain.stdout,
      stderr: plain.stderr,
      exitCode: plain.exitCode,
      timedOut: plain.timedOut,
      networkIsolated: false,
      networkIsolationFailed: isolationFailed,
      usedCwd,
    };
  } finally {
    // The temp sandbox home is never the caller's cwd, so a single unconditional
    // cleanup suffices (the brief's redundant-looking branches simplify to this).
    await rm(sandboxHome, { recursive: true, force: true });
  }
}
