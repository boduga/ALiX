/**
 * P4.3-Sd1 — Cross-Process Audit Lock
 *
 * Provides exclusive file-based locking for concurrent CLI/daemon processes
 * writing to the same audit log. Uses O_EXCL (`wx` flag) for atomic create,
 * PID+host metadata for stale detection, and bounded exponential backoff for
 * retry.
 *
 * @module
 */

import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

// ---------------------------------------------------------------------------
// Stable error codes
// ---------------------------------------------------------------------------

export const LockErrorCodes = {
  LOCK_TIMEOUT: "LOCK_TIMEOUT",
  LOCK_STALE: "LOCK_STALE",
  LOCK_IO_ERROR: "LOCK_IO_ERROR",
  LOCK_ALREADY_HELD: "LOCK_ALREADY_HELD",
} as const;

export type LockErrorCode = (typeof LockErrorCodes)[keyof typeof LockErrorCodes];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockContent {
  pid: number;
  host: string;
  time: string; // ISO-8601
  nonce: string; // UUID v4
}

export interface LockHandle {
  ok: true;
  release(): void;
  /** For diagnostics. */
  readonly content: LockContent;
  readonly path: string;
}

export interface LockOptions {
  /** Maximum time (ms) to wait before giving up. Default 5000. */
  timeoutMs?: number;
  /** Initial backoff delay (ms). Default 100. */
  initialBackoffMs?: number;
  /** Backoff multiplier. Default 2. */
  backoffMultiplier?: number;
  /** Maximum number of retries. Default 10. */
  maxRetries?: number;
  /** Lock older than this (ms) is considered stale. Default 30000. */
  staleThresholdMs?: number;
  /**
   * What to do when a stale lock is detected.
   *
   * - `"auto"` — break the stale lock and acquire.
   * - `"manual"` — return `{ ok: false, error }`. Caller must decide.
   *
   * Default: `"manual"`.
   */
  staleRecovery?: "auto" | "manual";
}

export interface AcquireError {
  ok: false;
  error: string;
  code: LockErrorCode;
}

export type AcquireResult = LockHandle | AcquireError;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: Required<LockOptions> = {
  timeoutMs: 5000,
  initialBackoffMs: 100,
  backoffMultiplier: 2,
  maxRetries: 10,
  staleThresholdMs: 30_000,
  staleRecovery: "manual",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildLockContent(): LockContent {
  return {
    pid: process.pid,
    host: hostname(),
    time: new Date().toISOString(),
    nonce: randomUUID(),
  };
}

function readLockContent(path: string): LockContent | null {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as LockContent;
  } catch {
    return null;
  }
}

/**
 * Check whether a PID is alive on this host.
 * Signal 0 is a portable existence check (no signal is actually sent).
 */
function pidIsAlive(pid: number): boolean {
  try {
    // process.kill with signal 0 does not kill — it only checks existence.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isStale(content: LockContent, thresholdMs: number): boolean {
  const age = Date.now() - new Date(content.time).getTime();
  if (age > thresholdMs) return true;
  // Also check PID — if the owning process doesn't exist, the lock is stale.
  if (!pidIsAlive(content.pid)) return true;
  return false;
}

/**
 * Remove a lock file. Errors are silently swallowed — the lock file may
 * have already been removed by another process.
 */
function removeLockFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Best-effort cleanup.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Acquire an exclusive cross-process lock at `lockPath`.
 *
 * The lock directory is created if it does not exist. The lock file is
 * written atomically with the `wx` flag (exclusive create).
 *
 * Retries with bounded exponential backoff on contention:
 *   delay = min(initialBackoffMs * (backoffMultiplier ^ attempt), 5000)
 *   up to `maxRetries` attempts, bounded by `timeoutMs`.
 *
 * Stale lock handling:
 *   - If `staleRecovery` is `"auto"`, stale locks are broken and re-acquired.
 *   - If `staleRecovery` is `"manual"` (default), a stale lock returns an error.
 *
 * @returns A `LockHandle` with a `release()` method on success, or an error.
 */
export async function acquire(
  lockPath: string,
  opts?: LockOptions,
): Promise<AcquireResult> {
  const o = { ...DEFAULTS, ...opts };
  const dir = dirname(lockPath);

  // Ensure lock directory exists.
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return { ok: false, error: "Failed to create lock directory", code: LockErrorCodes.LOCK_IO_ERROR };
  }

  const content = buildLockContent();
  const deadline = Date.now() + o.timeoutMs;
  let attempt = 0;

  while (attempt <= o.maxRetries) {
    // Check timeout.
    if (Date.now() > deadline) {
      return {
        ok: false,
        error: `Lock acquisition timed out after ${o.timeoutMs}ms`,
        code: LockErrorCodes.LOCK_TIMEOUT,
      };
    }

    // Try exclusive create.
    try {
      writeFileSync(lockPath, JSON.stringify(content), { encoding: "utf-8", flag: "wx" });
      // Success — return the handle.
      return {
        ok: true as const,
        release(): void {
          removeLockFile(lockPath);
        },
        get content(): LockContent {
          return { ...content };
        },
        get path(): string {
          return lockPath;
        },
      };
    } catch (err: unknown) {
      // EEXIST means the file already exists — check for stale lock.
      const code = (err as { code?: string }).code;
      if (code === "EEXIST") {
        const existing = readLockContent(lockPath);
        if (existing && isStale(existing, o.staleThresholdMs)) {
          if (o.staleRecovery === "auto") {
            // Break the stale lock and retry immediately.
            removeLockFile(lockPath);
            continue; // next iteration will attempt acquire
          }
          // Manual mode — return error.
          return {
            ok: false,
            error: `Stale lock detected (pid=${existing.pid}, host=${existing.host}, age=${Date.now() - new Date(existing.time).getTime()}ms)`,
            code: LockErrorCodes.LOCK_STALE,
          };
        }
        // Lock is held and not stale — backoff and retry.
        attempt++;
        if (attempt > o.maxRetries) {
          return {
            ok: false,
            error: `Lock acquisition failed after ${attempt} retries`,
            code: LockErrorCodes.LOCK_TIMEOUT,
          };
        }
        const delay = Math.min(
          o.initialBackoffMs * Math.pow(o.backoffMultiplier, attempt - 1),
          5000,
        );
        const remaining = deadline - Date.now();
        if (delay >= remaining) {
          return {
            ok: false,
            error: `Lock acquisition timed out before retry ${attempt}`,
            code: LockErrorCodes.LOCK_TIMEOUT,
          };
        }
        await sleep(delay);
        continue;
      }
      // Other I/O error.
      return {
        ok: false,
        error: `Lock I/O error: ${String(err)}`,
        code: LockErrorCodes.LOCK_IO_ERROR,
      };
    }
  }

  return {
    ok: false,
    error: `Lock acquisition failed after ${attempt} attempts`,
    code: LockErrorCodes.LOCK_TIMEOUT,
  };
}

/**
 * Release a lock handle synchronously.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function release(handle: LockHandle): void {
  handle.release();
}
