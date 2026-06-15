/**
 * coordination-run-lock.ts -- Per-run file lock for CoordinationStore.
 *
 * Uses atomic mkdir for locking. Each run gets its own lock directory at:
 *   .alix/coordination/locks/<runId>.lock
 *
 * Features:
 *   - Configurable timeout
 *   - Stale lock detection (PID not alive)
 *   - Token-safe release (only the lock owner can release)
 *   - Always release in finally
 */

import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const STALE_LOCK_MS = 60_000;
const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

export type CoordinationLockMetadata = {
  pid: number;
  token: string;
  acquiredAt: string;
};

function lockMetaPath(lockPath: string): string {
  return join(lockPath, "meta.json");
}

function readLockMetadata(lockPath: string): CoordinationLockMetadata | null {
  try {
    const raw = readFileSync(lockMetaPath(lockPath), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isStaleLock(lockPath: string): boolean {
  if (!existsSync(lockPath)) return false;
  const meta = readLockMetadata(lockPath);
  if (!meta) return false;
  const age = Date.now() - new Date(meta.acquiredAt).getTime();
  if (age < STALE_LOCK_MS) return false;
  try {
    process.kill(meta.pid, 0);
    return false;
  } catch {
    return true;
  }
}

export class CoordinationRunLock {
  private readonly lockPath: string;
  private readonly token: string;
  private acquired = false;

  constructor(cwd: string, runId: string) {
    this.lockPath = join(cwd, ".alix", "coordination", "locks", `${runId}.lock`);
    this.token = randomUUID();
  }

  async acquire(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    if (this.acquired) return true;
    const deadline = Date.now() + timeoutMs;
    mkdirSync(dirname(this.lockPath), { recursive: true });

    while (Date.now() < deadline) {
      try {
        mkdirSync(this.lockPath);
        const meta: CoordinationLockMetadata = {
          pid: process.pid,
          token: this.token,
          acquiredAt: new Date().toISOString(),
        };
        writeFileSync(lockMetaPath(this.lockPath), JSON.stringify(meta), "utf-8");
        this.acquired = true;
        return true;
      } catch {
        if (isStaleLock(this.lockPath)) {
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
        const saved = readLockMetadata(this.lockPath);
        if (saved && saved.token === this.token) {
          rmSync(this.lockPath, { recursive: true, force: true });
        }
      }
    } catch { /* best-effort */ }
    this.acquired = false;
  }

  isHeld(): boolean {
    return this.acquired;
  }
}
