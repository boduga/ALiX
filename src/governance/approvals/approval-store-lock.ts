/**
 * approval-store-lock.ts — Per-file lock for ApprovalStore.
 *
 * Uses atomic mkdir for locking. Lock stored at .alix/approvals/approvals.lock.
 * Token-safe release, ownership-safe atomic stale-PID reclaim.
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Age backstop ceiling (ms). Applied ONLY when the lock's owner cannot be
 * proven dead or alive — an invalid/missing PID, or missing/malformed
 * metadata. It is never applied to a valid PID that is provably alive.
 */
const STALE_LOCK_MS = 60_000;
const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

export type ApprovalLockMetadata = {
  pid: number;
  token: string;
  acquiredAt: string;
};

export class ApprovalStoreLock {
  private readonly lockPath: string;
  private readonly token: string;
  private acquired = false;

  constructor(cwd: string) {
    this.lockPath = join(cwd, ".alix", "approvals", "approvals.lock");
    this.token = randomUUID();
  }

  async acquire(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    if (this.acquired) return true;
    const deadline = Date.now() + timeoutMs;
    mkdirSync(dirname(this.lockPath), { recursive: true, mode: 0o700 });

    while (Date.now() < deadline) {
      try {
        mkdirSync(this.lockPath);
        writeFileSync(
          join(this.lockPath, "meta.json"),
          JSON.stringify({ pid: process.pid, token: this.token, acquiredAt: new Date().toISOString() } as ApprovalLockMetadata),
          "utf-8",
        );
        this.acquired = true;
        return true;
      } catch {
        if (this.reclaimStaleLock()) continue;
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    return false;
  }

  release(): void {
    if (!this.acquired) return;
    try {
      if (existsSync(this.lockPath)) {
        const metaPath = join(this.lockPath, "meta.json");
        if (existsSync(metaPath)) {
          const saved = JSON.parse(readFileSync(metaPath, "utf-8")) as ApprovalLockMetadata;
          if (saved.token === this.token) {
            rmSync(this.lockPath, { recursive: true, force: true });
          }
        }
      }
    } catch { /* best-effort */ }
    this.acquired = false;
  }

  isHeld(): boolean { return this.acquired; }

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
    if (!lockIsStale(this.lockPath)) return false;

    const tombstone = `${this.lockPath}.stale-${randomUUID()}`;
    try {
      renameSync(this.lockPath, tombstone);
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
    try { renameSync(tombstone, this.lockPath); } catch { /* best-effort */ }
    return false;
  }
}

/**
 * A lock is stale only when its owner can no longer be holding it:
 *
 *  - a valid, provably DEAD PID (signal-0 → ESRCH) is stale immediately — no
 *    age gate, so a daemon SIGKILLed inside `mutate()` is recovered right away
 *    instead of stalling every later mutation for a full minute;
 *  - a valid, provably ALIVE PID (signal-0 succeeds, or fails with EPERM for a
 *    process we cannot signal but that exists) is NEVER stale on age alone —
 *    age is a backstop for unprovable owners, never a license to steal a live
 *    lock (D9 review Finding 1);
 *  - an owner that cannot be proven — invalid/missing PID (Finding 2), or
 *    missing/malformed metadata (Finding 3) — is stale only after the age
 *    backstop {@link STALE_LOCK_MS}, measured on the metadata timestamp when
 *    available and on the directory mtime otherwise.
 */
function lockIsStale(lockPath: string): boolean {
  const metaPath = join(lockPath, "meta.json");
  if (!existsSync(metaPath)) {
    // No metadata: a live owner creates the directory and writes metadata
    // immediately after. Age the directory so a young window is respected
    // while a SIGKILL orphan (killed between mkdir and write) is reclaimed
    // after the backstop instead of stalling recovery forever.
    return directoryAgeMs(lockPath) > STALE_LOCK_MS;
  }

  let meta: ApprovalLockMetadata;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf-8")) as ApprovalLockMetadata;
  } catch {
    // Malformed metadata: the owner's state cannot be proven. Age the
    // directory rather than stealing immediately.
    return directoryAgeMs(lockPath) > STALE_LOCK_MS;
  }

  const pid = meta.pid;
  if (Number.isFinite(pid) && pid > 0) {
    return !pidIsAlive(pid);
  }

  // Missing/invalid PID: cannot prove the owner dead. Age is the only signal.
  const acquiredAt = new Date(meta.acquiredAt).getTime();
  if (!Number.isFinite(acquiredAt)) return directoryAgeMs(lockPath) > STALE_LOCK_MS;
  return Date.now() - acquiredAt > STALE_LOCK_MS;
}

/**
 * Age of the lock directory, from the mtime of its last write (the metadata
 * write, or the mkdir itself when no metadata was written). mtime, not
 * birthtime: for a SIGKILL orphan with no metadata the two coincide, and for a
 * malformed partial write mtime reflects the last write attempt. Returns 0 when
 * the directory cannot be stat'd, so an unreadable lock reads as young
 * (fail-closed: never reclaimed on a stat failure).
 */
function directoryAgeMs(lockPath: string): number {
  try {
    const st = statSync(lockPath);
    const ref = Number.isFinite(st.mtimeMs) && st.mtimeMs > 0 ? st.mtimeMs : st.birthtimeMs;
    if (!Number.isFinite(ref) || ref <= 0) return 0;
    return Date.now() - ref;
  } catch {
    return 0;
  }
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
