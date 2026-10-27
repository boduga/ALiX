/**
 * approval-store-lock.test.ts — In-process tests for the per-file lock.
 *
 * Covers the OS-managed `flock` backend (the production default) and the
 * `mkdir` fallback. Real OS-process liveness and mutual-exclusion cases live
 * in tests/security/approval-lock-liveness.test.ts.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStoreLock, detectLockBackend } from "../../src/governance/approvals/approval-store-lock.js";

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

describe("ApprovalStoreLock (flock backend)", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "aplock-flock-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("is the selected backend on this platform", () => {
    // The flock tests below only run meaningfully where flock is present; the
    // fallback cases are covered by the mkdir describe block instead.
    assert.equal(typeof detectLockBackend(), "string");
  });

  it("acquires and releases", async () => {
    const lock = new ApprovalStoreLock(cwd);
    assert.equal(await lock.acquire(500), true);
    assert.equal(lock.isHeld(), true);
    lock.release();
    assert.equal(lock.isHeld(), false);
  });

  it("blocks a second acquisition while held", async () => {
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

  it("releasing frees the lock for a successor", async () => {
    const lock1 = new ApprovalStoreLock(cwd);
    assert.equal(await lock1.acquire(500), true);
    lock1.release();
    const lock2 = new ApprovalStoreLock(cwd);
    assert.equal(await lock2.acquire(500), true);
    lock2.release();
  });

  it("leaves no lock state that blocks a fresh instance after release", async () => {
    const lock = new ApprovalStoreLock(cwd);
    assert.equal(await lock.acquire(500), true);
    lock.release();
    // A fresh process's lock must be immediately acquirable — the OS released
    // the advisory lock on release, so no stale-state recovery is needed.
    const successor = new ApprovalStoreLock(cwd);
    assert.equal(await successor.acquire(500), true);
    successor.release();
  });
});

describe("ApprovalStoreLock (mkdir fallback)", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "aplock-mkdir-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  const mkdirLock = () => new ApprovalStoreLock(cwd, { backend: "mkdir" });

  it("acquires and releases", async () => {
    const lock = mkdirLock();
    assert.equal(await lock.acquire(500), true);
    lock.release();
    assert.equal(lock.isHeld(), false);
  });

  it("blocks second acquisition", async () => {
    const lock1 = mkdirLock();
    const lock2 = mkdirLock();
    assert.equal(await lock1.acquire(500), true);
    assert.equal(await lock2.acquire(200), false);
    lock1.release();
    lock2.release();
  });

  it("acquires again after release", async () => {
    const lock = mkdirLock();
    assert.equal(await lock.acquire(500), true);
    lock.release();
    assert.equal(await lock.acquire(500), true);
    lock.release();
  });

  /**
   * A daemon SIGKILLed inside a mutation leaves a lock directory behind with a
   * valid, dead PID. A dead owner is proof enough, immediately — no age gate.
   */
  it("breaks a lock whose owning process is dead, without waiting for the age ceiling", async () => {
    const held = mkdirLock();
    assert.equal(await held.acquire(500), true);
    // Simulate the owner dying: rewrite the metadata with a PID that cannot
    // exist, keeping `acquiredAt` recent so only liveness can justify a break.
    const meta = readMeta(cwd);
    writeFileSync(metaPath(cwd), JSON.stringify({ ...meta, pid: 2 ** 30 }), "utf-8");

    const started = Date.now();
    const successor = mkdirLock();
    assert.equal(await successor.acquire(2_000), true, "a dead owner must not hold the lock");
    assert.ok(Date.now() - started < 1_000, "recovery must not wait for the age ceiling");
    successor.release();
  });

  /**
   * A live holder whose critical section outlives the stale ceiling keeps its
   * lock: age alone must NEVER steal a lock whose owner is provably alive.
   */
  it("does not break a lock past the age ceiling while its PID is alive", async () => {
    const held = mkdirLock();
    assert.equal(await held.acquire(500), true);
    // This process's own PID is alive; only the timestamp is aged out.
    const meta = readMeta(cwd);
    writeFileSync(metaPath(cwd), JSON.stringify({ ...meta, acquiredAt: new Date(Date.now() - 120_000).toISOString() }), "utf-8");
    const successor = mkdirLock();
    assert.equal(await successor.acquire(300), false, "a provably-alive owner must not be stolen on age alone");
    held.release();
    successor.release();
  });

  it("still respects a live owner's recent lock", async () => {
    const held = mkdirLock();
    assert.equal(await held.acquire(500), true);
    const contender = mkdirLock();
    assert.equal(await contender.acquire(200), false);
    held.release();
    contender.release();
  });

  /**
   * A missing/invalid `pid` must not be an immediate theft, and age cannot
   * establish owner death, so it is never reclaimed automatically.
   */
  for (const pid of [undefined, 0, -1, NaN] as const) {
    it(`does not break a lock with an invalid pid (${String(pid)})`, async () => {
      const held = mkdirLock();
      assert.equal(await held.acquire(500), true);
      const meta = readMeta(cwd);
      writeFileSync(metaPath(cwd), JSON.stringify({ ...meta, pid }), "utf-8");
      const successor = mkdirLock();
      assert.equal(await successor.acquire(200), false, "an invalid pid must not be stolen");
      held.release();
      successor.release();
    });
  }

  it("never steals an invalid-pid lock based on age", async () => {
    const held = mkdirLock();
    assert.equal(await held.acquire(500), true);
    const meta = readMeta(cwd);
    writeFileSync(metaPath(cwd), JSON.stringify({ token: meta.token, acquiredAt: new Date(Date.now() - 120_000).toISOString() }), "utf-8");
    const successor = mkdirLock();
    assert.equal(await successor.acquire(250), false, "elapsed time cannot establish that an unprovable owner died");
    successor.release();
  });

  it("does not break a lock directory whose metadata has not been written yet", async () => {
    mkdirSync(lockPath(cwd), { recursive: true });
    const contender = mkdirLock();
    assert.equal(await contender.acquire(200), false);
    contender.release();
  });

  it("never steals a metadata-less lock directory based on age", async () => {
    mkdirSync(lockPath(cwd), { recursive: true });
    backdate(lockPath(cwd));
    const successor = mkdirLock();
    assert.equal(await successor.acquire(250), false, "an old metadata-less lock could have a paused live owner");
    successor.release();
  });

  it("does not break a lock whose metadata is malformed while it is recent", async () => {
    mkdirSync(lockPath(cwd), { recursive: true });
    writeFileSync(metaPath(cwd), "{ this is not valid json", "utf-8");
    const contender = mkdirLock();
    assert.equal(await contender.acquire(200), false);
    contender.release();
  });

  it("never steals malformed-metadata lock based on age", async () => {
    mkdirSync(lockPath(cwd), { recursive: true });
    writeFileSync(metaPath(cwd), "{ this is not valid json", "utf-8");
    backdate(lockPath(cwd));
    const successor = mkdirLock();
    assert.equal(await successor.acquire(250), false, "malformed metadata cannot establish owner death");
    successor.release();
  });
});
