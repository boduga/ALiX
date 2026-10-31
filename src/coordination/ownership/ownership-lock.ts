/**
 * ownership-lock.ts — Cross-process lock for OwnershipRegistry atomicity.
 *
 * Ownership reuses the repository's qualified ApprovalStoreLock primitive
 * rather than maintaining a second stale-lock algorithm. On Linux the lock is
 * kernel-owned `flock`, released automatically on process death. Where flock
 * is unavailable, the shared fail-closed mkdir backend performs atomic
 * rename/reverify reclaim only for provably dead owners.
 */

import { join } from "node:path";
import {
  ApprovalStoreLock,
  type LockBackendName,
} from "../../governance/approvals/approval-store-lock.js";

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;

export class OwnershipLock {
  private readonly delegate: ApprovalStoreLock;

  constructor(cwd: string, options?: { backend?: LockBackendName }) {
    this.delegate = new ApprovalStoreLock(cwd, {
      backend: options?.backend,
      lockPath: join(cwd, ".alix", "ownership", "ownership.lock"),
    });
  }

  acquire(timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS): Promise<boolean> {
    return this.delegate.acquire(timeoutMs);
  }

  release(): void {
    this.delegate.release();
  }

  get isHeld(): boolean {
    return this.delegate.isHeld();
  }
}
