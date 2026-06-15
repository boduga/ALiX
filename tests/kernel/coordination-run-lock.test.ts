import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationRunLock } from "../../src/kernel/coordination-run-lock.js";

describe("CoordinationRunLock", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "runlock-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("acquires and releases", async () => {
    const lock = new CoordinationRunLock(cwd, "run-1");
    const acquired = await lock.acquire(500);
    assert.equal(acquired, true);
    lock.release();
    assert.equal(lock.isHeld(), false);
  });

  it("blocks second acquisition", async () => {
    const lock1 = new CoordinationRunLock(cwd, "run-1");
    const lock2 = new CoordinationRunLock(cwd, "run-1");
    assert.equal(await lock1.acquire(500), true);
    assert.equal(await lock2.acquire(200), false);
    lock1.release();
    lock2.release();
  });

  it("allows different run IDs concurrently", async () => {
    const lock1 = new CoordinationRunLock(cwd, "run-1");
    const lock2 = new CoordinationRunLock(cwd, "run-2");
    assert.equal(await lock1.acquire(500), true);
    assert.equal(await lock2.acquire(500), true);
    lock1.release();
    lock2.release();
  });

  it("acquires again after release", async () => {
    const lock = new CoordinationRunLock(cwd, "run-1");
    assert.equal(await lock.acquire(500), true);
    lock.release();
    assert.equal(await lock.acquire(500), true);
    lock.release();
  });

  it("token mismatch cannot release", async () => {
    // Simulate a lock from another instance by creating the lock dir directly
    const lockDir = join(cwd, ".alix", "coordination", "locks", "run-1.lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "meta.json"), JSON.stringify({
      pid: process.pid,
      token: "other-token",
      acquiredAt: new Date().toISOString(),
    }), "utf-8");

    const lock = new CoordinationRunLock(cwd, "run-1");
    // This should fail to acquire because the lock exists and our token doesn't match
    const acquired = await lock.acquire(200);
    assert.equal(acquired, false);
  });
});
