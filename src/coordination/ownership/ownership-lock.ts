/**
 * ownership-lock.ts — File-based lock for OwnershipRegistry atomicity.
 *
 * Prevents concurrent agents from reading stale state and writing conflicting
 * leases. Uses a lock file with fail-closed stale-lock recovery: same-host
 * locks are reclaimed only when the owning PID is provably dead; cross-host
 * locks are never age-stolen automatically. Each lock acquisition gets a unique UUID token;
 * release verifies the token still owns the lock before unlinking.
 *
 * Long-term: ownership moves into the daemon process as the sole writer.
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;          // max wait (CLI UX)

type LockMetadata = {
  token: string;
  pid: number;
  timestamp: number;
  hostname: string;
};

export class OwnershipLock {
  private lockPath: string;
  private held = false;
  private myToken = "";

  constructor(cwd: string) {
    this.lockPath = join(cwd, ".alix", "ownership", "ownership.lock");
  }

  /**
   * Acquire the lock. Blocks (polls) up to timeoutMs.
   * Stale only when a same-host owning PID is provably dead.
   * Cross-host ownership cannot be proven locally and therefore fails closed.
   */
  async acquire(timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS): Promise<boolean> {
    mkdirSync(dirname(this.lockPath), { recursive: true });

    const token = randomUUID();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (!existsSync(this.lockPath)) {
        try {
          writeFileSync(this.lockPath, this.serialize(token), { flag: "wx" });
          this.held = true;
          this.myToken = token;
          return true;
        } catch {
          // Race lost — another process created it first
        }
      }

      if (existsSync(this.lockPath)) {
        const meta = this.readMetadata();
        if (meta && this.isStale(meta)) {
          try { unlinkSync(this.lockPath); } catch { /* raced */ }
          continue;
        }
      }

      await this.sleep(200);
    }

    return false;
  }

  /**
   * Release the lock only if OUR token still owns it.
   * Prevents deleting a lock that was reclaimed by another process
   * after a stale-lock break.
   */
  release(): void {
    if (!this.held) return;
    try {
      const meta = this.readMetadata();
      if (meta && meta.token === this.myToken) {
        unlinkSync(this.lockPath);
      }
      // Token mismatch: another process reclaimed it — do not unlink.
    } catch {
      // Already removed
    }
    this.held = false;
    this.myToken = "";
  }

  get isHeld(): boolean {
    return this.held;
  }

  // ─── Private ────────────────────────────────────────────────

  private serialize(token: string): string {
    return `${token}:${process.pid}:${Date.now()}:${hostname()}`;
  }

  private readMetadata(): LockMetadata | null {
    try {
      const raw = readFileSync(this.lockPath, "utf-8").trim();
      const parts = raw.split(":");
      if (parts.length < 4) return null;
      return {
        token: parts[0],
        pid: parseInt(parts[1], 10),
        timestamp: parseInt(parts[2], 10),
        hostname: parts.slice(3).join(":") || "",
      };
    } catch {
      return null;
    }
  }

  /**
   * Reclaim only when same-host ownership is provably dead.
   * Malformed metadata and cross-host locks fail closed: automatic stealing
   * would permit concurrent registry writers without a fencing token.
   */
  private isStale(meta: LockMetadata): boolean {
    if (!Number.isFinite(meta.pid) || !Number.isFinite(meta.timestamp)) return false;
    if (!meta.hostname || meta.hostname !== hostname()) return false;
    return !this.isPidAlive(meta.pid);
  }

  private isPidAlive(pid: number): boolean {
    try {
      if (existsSync(`/proc/${pid}`)) return true;
      return process.kill(pid, 0);
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
