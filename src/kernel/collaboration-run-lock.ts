/**
 * collaboration-run-lock.ts — Per-run lock for the collaboration store.
 *
 * Lock path: .alix/coordination/shared/locks/<runId>.lock
 * Uses atomic mkdir acquisition, PID metadata, stale recovery, token-safe release.
 *
 * Mirrors the CoordinationRunLock pattern.
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const STALE_LOCK_MS = 60_000;
const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

export type CollaborationLockMetadata = {
  pid: number;
  token: string;
  acquiredAt: string;
};

export class CollaborationRunLock {
  private readonly lockPath: string;
  private readonly token: string;
  private acquired = false;

  constructor(cwd: string, runId: string) {
    this.lockPath = join(cwd, ".alix", "coordination", "shared", "locks", `${runId}.lock`);
    this.token = randomUUID();
  }

  async acquire(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    if (this.acquired) return true;
    const deadline = Date.now() + timeoutMs;
    mkdirSync(dirname(this.lockPath), { recursive: true });

    while (Date.now() < deadline) {
      try {
        mkdirSync(this.lockPath);
        writeFileSync(
          join(this.lockPath, "meta.json"),
          JSON.stringify({ pid: process.pid, token: this.token, acquiredAt: new Date().toISOString() } as CollaborationLockMetadata),
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
          const saved = JSON.parse(readFileSync(metaPath, "utf-8")) as CollaborationLockMetadata;
          if (saved.token === this.token) {
            rmSync(this.lockPath, { recursive: true, force: true });
          }
        }
      }
    } catch { /* best-effort */ }
    this.acquired = false;
  }

  isHeld(): boolean { return this.acquired; }

  private isStale(): boolean {
    try {
      const metaPath = join(this.lockPath, "meta.json");
      if (!existsSync(metaPath)) return false;
      const saved = JSON.parse(readFileSync(metaPath, "utf-8")) as CollaborationLockMetadata;
      if (Date.now() - new Date(saved.acquiredAt).getTime() < STALE_LOCK_MS) return false;
      try { process.kill(saved.pid, 0); return false; } catch { return true; }
    } catch { return false; }
  }
}
