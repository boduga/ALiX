/**
 * approval-store-lock.test.ts — Tests for the per-file lock.
 *
 * In-process deterministic cases for the staleness decision. Real OS-process
 * liveness and mutual-exclusion cases live in
 * tests/security/approval-lock-liveness.test.ts.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStoreLock } from "../../src/governance/approvals/approval-store-lock.js";

const LOCK_DIR = [".alix", "approvals", "approvals.lock"];
const STALE_LOCK_MS = 60_000;

function lockPath(cwd: string): string { return join(cwd, ...LOCK_DIR); }
function metaPath(cwd: string): string { return join(cwd, ...LOCK_DIR, "meta.json"); }

/** Backdate a directory's mtime so its age exceeds the stale ceiling. */
function backdate(lockDir: string): void {
  const old = new Date(Date.now() - STALE_LOCK_MS - 5_000);
  utimesSync(lockDir, old, old);
}

function readMeta(cwd: string): { pid: number; token: string; acquiredAt: string } {
  return JSON.parse(readFileSync(metaPath(cwd), "utf-8"));
}

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
   * behind with no process to release it. A dead owner is proof enough,
   * immediately — no age gate.
   */
  it("breaks a lock whose owning process is dead, without waiting for the age ceiling", async () => {
    const held = new ApprovalStoreLock(cwd);
    assert.equal(await held.acquire(500), true);
    // Simulate the owner dying: rewrite the metadata with a PID that cannot
    // exist, keeping `acquiredAt` recent so only liveness can justify a break.
    const meta = readMeta(cwd);
    writeFileSync(metaPath(cwd), JSON.stringify({ ...meta, pid: 2 ** 30 }), "utf-8");

    const started = Date.now();
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(2_000), true, "a dead owner must not hold the lock");
    assert.ok(Date.now() - started < 1_000, "recovery must not wait for the age ceiling");
    successor.release();
  });

  /**
   * Finding 1 (HIGH): age alone must NEVER steal a lock whose owner is
   * provably alive. A live holder whose critical section outlives the stale
   * ceiling (slow disk, SIGSTOP, container checkpoint) keeps its lock; the age
   * bound is a backstop for unprovable owners, not a license to steal.
   */
  it("does not break a lock past the age ceiling while its PID is alive", async () => {
    const held = new ApprovalStoreLock(cwd);
    assert.equal(await held.acquire(500), true);
    // This process's own PID is alive; only the timestamp is aged out.
    const meta = readMeta(cwd);
    writeFileSync(metaPath(cwd), JSON.stringify({ ...meta, acquiredAt: new Date(Date.now() - 120_000).toISOString() }), "utf-8");
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(300), false, "a provably-alive owner must not be stolen on age alone");
    held.release();
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

  /**
   * Finding 2 (MEDIUM): a missing/invalid `pid` must not be an immediate theft.
   * The owner cannot be proven dead, so a recent record stays respected.
   */
  for (const pid of [undefined, 0, -1, NaN] as const) {
    it(`does not break a lock with an invalid pid (${String(pid)}) while it is recent`, async () => {
      const held = new ApprovalStoreLock(cwd);
      assert.equal(await held.acquire(500), true);
      const meta = readMeta(cwd);
      writeFileSync(metaPath(cwd), JSON.stringify({ ...meta, pid }), "utf-8");
      const successor = new ApprovalStoreLock(cwd);
      assert.equal(await successor.acquire(200), false, "an invalid pid must not be stolen immediately");
      held.release();
      successor.release();
    });
  }

  /**
   * Finding 2 (cont.): an unprovable owner (invalid pid) ages out only after
   * the backstop — the same posture as every other unprovable case.
   */
  it("breaks an invalid-pid lock only after the age backstop", async () => {
    const held = new ApprovalStoreLock(cwd);
    assert.equal(await held.acquire(500), true);
    const meta = readMeta(cwd);
    writeFileSync(metaPath(cwd), JSON.stringify({ token: meta.token, acquiredAt: new Date(Date.now() - 120_000).toISOString() }), "utf-8");
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(2_000), true, "an old unprovable owner is reclaimable after the backstop");
    successor.release();
  });

  /**
   * Finding 3 (MEDIUM): a metadata-less directory is the owner's mkdir→write
   * window. A young directory stays respected (no theft of the live writer).
   */
  it("does not break a lock directory whose metadata has not been written yet", async () => {
    mkdirSync(lockPath(cwd), { recursive: true });
    const contender = new ApprovalStoreLock(cwd);
    assert.equal(await contender.acquire(200), false);
    contender.release();
  });

  /**
   * Finding 3 (cont.): a SIGKILL landing between mkdir and the metadata write
   * leaves a metadata-less directory forever under the old rule. It must age
   * out (grace period) rather than stall recovery forever — without opening a
   * theft window for a live writer, whose window lasts microseconds, not a
   * full stale ceiling.
   */
  it("breaks a metadata-less lock directory only after the age backstop", async () => {
    mkdirSync(lockPath(cwd), { recursive: true });
    backdate(lockPath(cwd));
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(2_000), true, "an old metadata-less orphan must be reclaimable");
    successor.release();
  });

  /**
   * Malformed metadata cannot prove the owner's state: fail closed while
   * recent, reclaim only after the directory ages out.
   */
  it("does not break a lock whose metadata is malformed while it is recent", async () => {
    mkdirSync(lockPath(cwd), { recursive: true });
    writeFileSync(metaPath(cwd), "{ this is not valid json", "utf-8");
    const contender = new ApprovalStoreLock(cwd);
    assert.equal(await contender.acquire(200), false);
    contender.release();
  });

  it("breaks a malformed-metadata lock only after the age backstop", async () => {
    mkdirSync(lockPath(cwd), { recursive: true });
    writeFileSync(metaPath(cwd), "{ this is not valid json", "utf-8");
    backdate(lockPath(cwd));
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(2_000), true, "an old malformed-metadata orphan must be reclaimable");
    successor.release();
  });
});
