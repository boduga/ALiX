/**
 * approval-store-lock.test.ts — Tests for the per-file lock.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStoreLock } from "../../src/governance/approvals/approval-store-lock.js";

describe("ApprovalStoreLock", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "aplock-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("acquires and releases", async () => {
    const lock = new ApprovalStoreLock(cwd);
    assert.equal(await lock.acquire(500), true);
    lock.release();
    assert.equal(lock.isHeld(), false);
  });

  it("blocks second acquisition", async () => {
    const lock1 = new ApprovalStoreLock(cwd);
    const lock2 = new ApprovalStoreLock(cwd);
    assert.equal(await lock1.acquire(500), true);
    assert.equal(await lock2.acquire(200), false);
    lock1.release();
    lock2.release();
  });

  it("acquires again after release", async () => {
    const lock = new ApprovalStoreLock(cwd);
    assert.equal(await lock.acquire(500), true);
    lock.release();
    assert.equal(await lock.acquire(500), true);
    lock.release();
  });

  /**
   * A daemon SIGKILLed inside a mutation leaves `.alix/approvals/approvals.lock`
   * behind with no process to release it. Requiring BOTH age and a dead PID
   * (age gate first) meant the lock was respected for a full minute: every
   * `mutate()` polled to its 10s timeout and threw "Could not acquire approval
   * lock", so approvals, execution receipts and worker recovery all failed
   * during crash recovery. A dead owner is proof enough, immediately.
   */
  it("breaks a lock whose owning process is dead, without waiting for the age ceiling", async () => {
    const held = new ApprovalStoreLock(cwd);
    assert.equal(await held.acquire(500), true);
    // Simulate the owner dying: rewrite the metadata with a PID that cannot
    // exist, keeping `acquiredAt` recent so only liveness can justify a break.
    const metaPath = join(cwd, ".alix", "approvals", "approvals.lock", "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { pid: number; token: string; acquiredAt: string };
    writeFileSync(metaPath, JSON.stringify({ ...meta, pid: 2 ** 30 }), "utf-8");

    const started = Date.now();
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(2_000), true, "a dead owner must not hold the lock");
    assert.ok(Date.now() - started < 1_000, "recovery must not wait for the age ceiling");
    successor.release();
  });

  it("still respects a live owner's recent lock", async () => {
    const held = new ApprovalStoreLock(cwd);
    assert.equal(await held.acquire(500), true);
    // Same PID as the running test process: alive, and recent — not stale.
    const contender = new ApprovalStoreLock(cwd);
    assert.equal(await contender.acquire(200), false);
    held.release();
    contender.release();
  });

  it("breaks a lock past the age ceiling even when its PID is alive", async () => {
    const held = new ApprovalStoreLock(cwd);
    assert.equal(await held.acquire(500), true);
    const metaPath = join(cwd, ".alix", "approvals", "approvals.lock", "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { pid: number; token: string; acquiredAt: string };
    // A live PID (this process) with an expired timestamp covers PID reuse and
    // cross-host/PID-namespace cases where liveness cannot be probed.
    writeFileSync(metaPath, JSON.stringify({ ...meta, acquiredAt: new Date(Date.now() - 120_000).toISOString() }), "utf-8");
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(2_000), true);
    successor.release();
  });

  /**
   * The owner creates the directory and only then writes `meta.json`. Treating
   * that window as stale would let a second process steal a live lock, so an
   * ownerless directory stays respected (bounded by the acquire timeout).
   */
  it("does not break a lock directory whose metadata has not been written yet", async () => {
    mkdirSync(join(cwd, ".alix", "approvals", "approvals.lock"), { recursive: true });
    const contender = new ApprovalStoreLock(cwd);
    assert.equal(await contender.acquire(200), false);
    contender.release();
  });
});
