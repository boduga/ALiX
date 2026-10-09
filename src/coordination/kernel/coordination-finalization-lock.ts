/**
 * coordination-finalization-lock.ts — Per-run finalization lock.
 *
 * Prevents concurrent finalization from producing duplicate aggregates
 * or conflicting writes. Uses atomic mkdir pattern.
 *
 * Lock path: .alix/coordination/results/runs/<runId>.lock
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const STALE_LOCK_MS = 60_000;
const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

export class CoordinationFinalizationLock {
  private readonly lockPath: string;
  private readonly token: string;
  private acquired = false;

  constructor(cwd: string, runId: string) {
    this.lockPath = join(cwd, ".alix", "coordination", "results", "runs", `${runId}.lock`);
    this.token = randomUUID();
  }

  async acquire(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    if (this.acquired) return true;
    const deadline = Date.now() + timeoutMs;
    mkdirSync(dirname(this.lockPath), { recursive: true });

    while (Date.now() < deadline) {
      try {
        mkdirSync(this.lockPath);
        writeFileSync(join(this.lockPath, "meta.json"), JSON.stringify({
          pid: process.pid, token: this.token, acquiredAt: new Date().toISOString(),
        }), "utf-8");
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
          const saved = JSON.parse(readFileSync(metaPath, "utf-8"));
          if (saved.token === this.token) {
            rmSync(this.lockPath, { recursive: true, force: true });
          }
        }
      }
    } catch { /* best-effort */ }
    this.acquired = false;
  }

  private isStale(): boolean {
    try {
      const metaPath = join(this.lockPath, "meta.json");
      if (!existsSync(metaPath)) return false;
      const saved = JSON.parse(readFileSync(metaPath, "utf-8"));
      if (Date.now() - new Date(saved.acquiredAt).getTime() < STALE_LOCK_MS) return false;
      try { process.kill(saved.pid, 0); return false; } catch { return true; }
    } catch { return false; }
  }
}
