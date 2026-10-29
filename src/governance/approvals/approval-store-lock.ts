/**
 * approval-store-lock.ts — Cross-process lock for ApprovalStore.
 *
 * The primary backend is OS-managed: an exclusive advisory `flock` on a lock
 * file (via the util-linux `flock` binary's file-descriptor form). The lock
 * lives in the kernel, so it is released automatically when the holding process
 * exits for any reason — including SIGKILL. There is no lock state to recover,
 * no PID to probe, no age to compare, and no reclaim race: a killed daemon
 * never stalls later mutations, and a live holder is never stolen on age.
 *
 * A fallback backend (atomic `mkdir` + PID liveness) is used only where no
 * `flock` binary is available (macOS/Windows CI). It is fail-closed: a
 * provably DEAD pid is reclaimed immediately; a provably ALIVE pid (signal-0
 * succeeds, or EPERM) is never reclaimed; and an unprovable owner
 * (invalid/missing pid, missing/malformed metadata) is never reclaimed by age,
 * because age cannot establish owner death. An unprovable orphan on those
 * platforms therefore requires explicit operator recovery — a documented
 * limitation of the fallback only, never a license to steal a live lock.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
  renameSync, openSync, closeSync, fstatSync, statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

export type ApprovalLockMetadata = {
  pid: number;
  token: string;
  acquiredAt: string;
};

/** Lock backends. `flock` is OS-managed (auto-released on process death). */
export type LockBackendName = "flock" | "mkdir";

interface ApprovalLockBackend {
  acquire(timeoutMs: number): Promise<boolean>;
  release(): void;
  isHeld(): boolean;
}

function lockDir(cwd: string): string {
  return join(cwd, ".alix", "approvals");
}

function lockPath(cwd: string): string {
  return join(lockDir(cwd), "approvals.lock");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Backend selection ──────────────────────────────────────────────────────

let detectedBackend: LockBackendName | undefined;

/**
 * Choose the lock backend for this platform: OS-managed `flock` where the
 * util-linux binary is present (Linux/BSD), the fail-closed `mkdir` lock
 * otherwise (macOS, Windows). Detected once and cached; a per-instance
 * `backend` option overrides it for tests.
 */
export function detectLockBackend(): LockBackendName {
  if (detectedBackend !== undefined) return detectedBackend;
  if (process.platform === "win32") {
    detectedBackend = "mkdir";
    return detectedBackend;
  }
  const probe = spawnSync("flock", ["--version"], { stdio: "ignore" });
  detectedBackend = probe.error || probe.status !== 0 ? "mkdir" : "flock";
  return detectedBackend;
}

// ─── OS-managed flock backend ───────────────────────────────────────────────

/** The child fd slot used to hand our open fd to the `flock` binary. */
const FLOCK_FD = 9;

/**
 * Open the lock target for the flock backend. Normally a regular file, created
 * if absent. A leftover DIRECTORY at the lock path (an orphan from the pre-flock
 * `mkdir` lock) is opened read-only instead: `flock` can lock a directory, so
 * new-process mutual exclusion still holds rather than throwing EISDIR.
 */
function openLockFd(path: string): number {
  try {
    return openSync(path, "a+");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") {
      return openSync(path, "r");
    }
    throw error;
  }
}

class FlockApprovalStoreLock implements ApprovalLockBackend {
  private readonly path: string;
  private fd: number | undefined;
  private acquired = false;

  constructor(cwd: string) {
    this.path = lockPath(cwd);
  }

  async acquire(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    if (this.acquired) return true;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

    // One fd is opened and reused across non-blocking attempts. On success the
    // fd stays open and IS the lock: the kernel holds an exclusive `flock` on
    // the open file description until this fd is closed, so SIGKILL of this
    // process closes it and releases the lock with no cleanup step.
    const fd = openLockFd(this.path);
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        const code = await this.tryFlock(fd);
        if (code === 0) {
          // A contender may have opened a stale inode after the pathname was
          // replaced. Never report acquisition of an unlinked lock target.
          // This detects replacement before the check; it cannot prevent a
          // privileged/external actor from unlinking the path afterward.
          const held = fstatSync(fd);
          const current = statSync(this.path);
          if (held.dev !== current.dev || held.ino !== current.ino) {
            return false;
          }
          this.fd = fd;
          this.acquired = true;
          return true;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      return false;
    } finally {
      if (!this.acquired) {
        try { closeSync(fd); } catch { /* already closed */ }
      }
    }
  }

  /**
   * Ask the `flock` binary to take a non-blocking exclusive lock on our open
   * fd. The child's fd 9 is a dup of the same open file description, so when
   * `flock` exits (immediately) the lock is held by OUR fd, not the child's.
   * Returns 0 when acquired, a non-zero exit code when contended, or null when
   * the binary could not run at all.
   */
  private tryFlock(fd: number): Promise<number | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (code: number | null) => {
        if (settled) return;
        settled = true;
        resolve(code);
      };
      const stdio = Array(FLOCK_FD).fill("ignore").concat([fd]);
      const child = spawn("flock", ["-n", "-x", String(FLOCK_FD)], { stdio });
      child.on("error", () => done(null));
      child.on("exit", (code) => done(code));
    });
  }

  release(): void {
    if (!this.acquired) return;
    this.acquired = false;
    const fd = this.fd;
    this.fd = undefined;
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }

  isHeld(): boolean {
    return this.acquired;
  }
}

// ─── mkdir fallback backend ─────────────────────────────────────────────────

class MkdirApprovalStoreLock implements ApprovalLockBackend {
  private readonly path: string;
  private readonly token: string;
  private acquired = false;

  constructor(cwd: string, overridePath?: string) {
    this.path = overridePath ?? lockPath(cwd);
    this.token = randomUUID();
  }

  async acquire(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    if (this.acquired) return true;
    const deadline = Date.now() + timeoutMs;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

    while (Date.now() < deadline) {
      try {
        mkdirSync(this.path);
        writeFileSync(
          join(this.path, "meta.json"),
          JSON.stringify({ pid: process.pid, token: this.token, acquiredAt: new Date().toISOString() } as ApprovalLockMetadata),
          "utf-8",
        );
        this.acquired = true;
        return true;
      } catch {
        if (this.reclaimStaleLock()) continue;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return false;
  }

  release(): void {
    if (!this.acquired) return;
    try {
      if (existsSync(this.path)) {
        const metaPath = join(this.path, "meta.json");
        if (existsSync(metaPath)) {
          const saved = JSON.parse(readFileSync(metaPath, "utf-8")) as ApprovalLockMetadata;
          if (saved.token === this.token) {
            rmSync(this.path, { recursive: true, force: true });
          }
        }
      }
    } catch { /* best-effort */ }
    this.acquired = false;
  }

  isHeld(): boolean {
    return this.acquired;
  }

  /**
   * Ownership-safe atomic reclaim of a stale lock.
   *
   * The staleness decision (`lockIsStale`) and the removal are two steps, so a
   * check-then-remove race would let two contenders both observe a dead owner
   * and both remove + re-acquire, entering their critical sections together.
   * The rename closes it: exactly one contender wins the POSIX rename (the
   * loser gets ENOENT and simply retries its own acquire), and the winner then
   * re-verifies the frozen copy before destroying it — or restores it if the
   * re-check proves a live owner the original read had not seen.
   */
  private reclaimStaleLock(): boolean {
    if (!lockIsStale(this.path)) return false;

    const tombstone = `${this.path}.stale-${randomUUID()}`;
    try {
      renameSync(this.path, tombstone);
    } catch {
      // Lost the race (another host reclaimed or the owner released), or the
      // lock vanished between the staleness check and the rename.
      return false;
    }

    if (lockIsStale(tombstone)) {
      rmSync(tombstone, { recursive: true, force: true });
      return true; // reclaimed — caller retries acquire
    }

    // The frozen copy proves a live owner: restore it rather than steal it.
    try { renameSync(tombstone, this.path); } catch { /* best-effort */ }
    return false;
  }
}

/**
 * A lock is stale only when its owner can no longer be holding it:
 *
 *  - a valid, provably DEAD PID (signal-0 → ESRCH) is stale immediately — no
 *    age gate, so a daemon SIGKILLed inside `mutate()` is recovered right away;
 *  - a valid, provably ALIVE PID (signal-0 succeeds, or fails with EPERM for a
 *    process we cannot signal but that exists) is NEVER stale on age alone;
 *  - an owner that cannot be proven — invalid/missing PID, or missing/malformed
 *    metadata — is never reclaimed automatically. Age cannot establish owner
 *    death, and reclaiming by age would let a paused live writer lose its lock.
 *    Such orphans require explicit operator recovery.
 */
function lockIsStale(lockPath: string): boolean {
  const metaPath = join(lockPath, "meta.json");
  if (!existsSync(metaPath)) {
    // No owner identity exists to validate. Even an old directory may belong
    // to a live process paused between mkdir and metadata creation. Fail
    // closed; an orphan requires explicit operator recovery, never an
    // unsafe automatic steal.
    return false;
  }

  let meta: ApprovalLockMetadata;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf-8")) as ApprovalLockMetadata;
  } catch {
    // An interrupted metadata write cannot prove that the writer is dead.
    // Reclaim by age would allow a paused live writer to lose its lock.
    return false;
  }

  const pid = meta.pid;
  if (Number.isFinite(pid) && pid > 0) {
    return !pidIsAlive(pid);
  }

  // Invalid PID cannot establish owner death. Never steal on elapsed time.
  return false;
}

/**
 * `process.kill(pid, 0)` is a portable existence probe: it sends nothing.
 * A permission error still proves the process exists (it belongs to another
 * user), so only "no such process" counts as dead.
 */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// ─── Public facade ──────────────────────────────────────────────────────────

export class ApprovalStoreLock implements ApprovalLockBackend {
  private readonly backend: ApprovalLockBackend;

  constructor(cwd: string, options?: { backend?: LockBackendName; lockPath?: string }) {
    const name = options?.backend ?? detectLockBackend();
    this.backend = name === "flock" ? new FlockApprovalStoreLock(cwd) : new MkdirApprovalStoreLock(cwd, options?.lockPath);
  }

  async acquire(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    return this.backend.acquire(timeoutMs);
  }

  release(): void {
    this.backend.release();
  }

  isHeld(): boolean {
    return this.backend.isHeld();
  }
}
