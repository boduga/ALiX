/**
 * replay-lock.ts — Per-replay file lock with stale detection.
 *
 * Lock file at .alix/replays/<replayId>/.lock prevents concurrent
 * mutation operations on the same replay artifact set.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { hostname } from "node:os";

export type ReplayLockInfo = {
  pid: number;
  hostname: string;
  replayId: string;
  operation: "rollback" | "replay";
  acquiredAt: string;
};

export const DEFAULT_LOCK_TTL_MS = 30_000;

export class ReplayLock {
  constructor(private cwd: string) {}

  private lockPath(replayId: string): string {
    return join(this.cwd, ".alix", "replays", replayId, ".lock");
  }

  async acquire(replayId: string, operation: "rollback" | "replay"): Promise<boolean> {
    const path = this.lockPath(replayId);
    if (existsSync(path)) {
      const stale = await this.isStale(replayId);
      if (!stale) return false;
      await this.forceRelease(replayId);
    }
    const info: ReplayLockInfo = {
      pid: process.pid,
      hostname: hostname(),
      replayId,
      operation,
      acquiredAt: new Date().toISOString(),
    };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(info, null, 2), "utf-8");
    return true;
  }

  async release(replayId: string): Promise<void> {
    const path = this.lockPath(replayId);
    if (existsSync(path)) rmSync(path);
  }

  async isLocked(replayId: string): Promise<boolean> {
    const path = this.lockPath(replayId);
    if (!existsSync(path)) return false;
    return !(await this.isStale(replayId));
  }

  async getLockInfo(replayId: string): Promise<ReplayLockInfo | null> {
    const path = this.lockPath(replayId);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ReplayLockInfo;
    } catch { return null; }
  }

  async isStale(replayId: string, ttlMs: number = DEFAULT_LOCK_TTL_MS): Promise<boolean> {
    const info = await this.getLockInfo(replayId);
    if (!info) return true;
    const age = Date.now() - new Date(info.acquiredAt).getTime();
    return age > ttlMs;
  }

  async forceRelease(replayId: string): Promise<void> {
    const path = this.lockPath(replayId);
    if (existsSync(path)) rmSync(path);
  }

  async cleanupStale(maxAgeMs: number = DEFAULT_LOCK_TTL_MS): Promise<string[]> {
    const { readdirSync } = await import("node:fs");
    const replaysDir = join(this.cwd, ".alix", "replays");
    if (!existsSync(replaysDir)) return [];
    const cleaned: string[] = [];
    for (const entry of readdirSync(replaysDir)) {
      const lockPath = join(replaysDir, entry, ".lock");
      if (existsSync(lockPath)) {
        try {
          const info = JSON.parse(readFileSync(lockPath, "utf-8")) as ReplayLockInfo;
          const age = Date.now() - new Date(info.acquiredAt).getTime();
          if (age > maxAgeMs) { rmSync(lockPath); cleaned.push(entry); }
        } catch { /* skip unparseable */ }
      }
    }
    return cleaned;
  }
}
