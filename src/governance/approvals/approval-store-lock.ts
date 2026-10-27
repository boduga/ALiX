/**
 * approval-store-lock.ts — Per-file lock for ApprovalStore.
 *
 * Uses atomic mkdir for locking. Lock stored at .alix/approvals/approvals.lock.
 * Token-safe release, stale PID recovery.
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

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
        if (this.isStale()) {
          rmSync(this.lockPath, { recursive: true, force: true });
          continue;
        }
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
   * A lock is stale when its owner can no longer be holding it.
   *
   * Two independent proofs — either one is sufficient:
   *  - the owning PID is gone, or
   *  - the lock is older than {@link STALE_LOCK_MS} (covers PID reuse and
   *    cross-host/PID-namespace cases where the PID cannot be probed).
   *
   * Requiring BOTH (the previous rule: age gate first, then liveness) meant a
   * lock left behind by a daemon killed mid-mutation was never broken for a
   * full minute: every `mutate()` then polled to its 10s timeout and threw
   * "Could not acquire approval lock", so approvals, outcomes and worker
   * recovery all failed during crash recovery. The age bound alone keeps the
   * break safe for a lock whose PID was recycled by an unrelated process.
   *
   * A lock directory with no `meta.json` is NOT stale: the owner creates the
   * directory and writes its metadata immediately after, and deleting that
   * window would let a second process steal a live lock.
   */
  private isStale(): boolean {
    try {
      const metaPath = join(this.lockPath, "meta.json");
      if (!existsSync(metaPath)) return false;
      const saved = JSON.parse(readFileSync(metaPath, "utf-8")) as ApprovalLockMetadata;
      const age = Date.now() - new Date(saved.acquiredAt).getTime();
      if (age > STALE_LOCK_MS) return true;
      if (!Number.isFinite(saved.pid) || saved.pid <= 0) return true;
      return !pidIsAlive(saved.pid);
    } catch { return false; }
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
