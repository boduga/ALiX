import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OwnershipLock } from "../../src/ownership/ownership-lock.js";

describe("OwnershipLock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "own-lock-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("acquires and releases lock", async () => {
    const lock = new OwnershipLock(dir);
    const acquired = await lock.acquire();
    assert.equal(acquired, true);
    assert.equal(lock.isHeld, true);
    lock.release();
    assert.equal(lock.isHeld, false);
  });

  it("creates lock file on acquire", async () => {
    const lock = new OwnershipLock(dir);
    await lock.acquire();
    const lockPath = join(dir, ".alix", "ownership", "ownership.lock");
    assert.ok(existsSync(lockPath));
    const content = readFileSync(lockPath, "utf-8");
    // Format: token:pid:timestamp:hostname
    const parts = content.split(":");
    assert.equal(parts.length, 4);
    assert.ok(parts[0].length > 0); // token
    assert.ok(!isNaN(parseInt(parts[1], 10))); // pid
    assert.ok(!isNaN(parseInt(parts[2], 10))); // timestamp
    lock.release();
  });

  it("removes lock file on release", async () => {
    const lock = new OwnershipLock(dir);
    await lock.acquire();
    const lockPath = join(dir, ".alix", "ownership", "ownership.lock");
    assert.ok(existsSync(lockPath));
    lock.release();
    assert.equal(existsSync(lockPath), false);
  });

  it("release does nothing when not held", () => {
    const lock = new OwnershipLock(dir);
    // Should not throw
    lock.release();
  });

  it("acquire times out when another process holds the lock", async () => {
    const lockA = new OwnershipLock(dir);
    const lockB = new OwnershipLock(dir);

    await lockA.acquire();
    // Other instance should fail to acquire (short timeout)
    const acquired = await lockB.acquire(500);
    assert.equal(acquired, false);
    lockA.release();
  });

  it("acquire succeeds after the lock is released", async () => {
    const lockA = new OwnershipLock(dir);
    const lockB = new OwnershipLock(dir);

    await lockA.acquire();
    lockA.release();

    const acquired = await lockB.acquire(500);
    assert.equal(acquired, true);
    lockB.release();
  });

  it("second acquire succeeds after release", async () => {
    const lock = new OwnershipLock(dir);
    assert.ok(await lock.acquire());
    lock.release();
    assert.ok(await lock.acquire());
    lock.release();
  });

  it("release only removes lock owned by its own token", async () => {
    const lockA = new OwnershipLock(dir);
    const lockB = new OwnershipLock(dir);

    await lockA.acquire();
    const lockPath = join(dir, ".alix", "ownership", "ownership.lock");
    const contentBefore = readFileSync(lockPath, "utf-8");

    // lockB's release should not remove lockA's file (token mismatch)
    // lockB was never acquired so release is a no-op
    lockB.release();
    assert.ok(existsSync(lockPath));
    const contentAfter = readFileSync(lockPath, "utf-8");
    assert.equal(contentBefore, contentAfter);

    lockA.release();
    assert.equal(existsSync(lockPath), false);
  });

  it("lock directory is created if it does not exist", async () => {
    // Remove the directory after creation so we can test auto-creation
    const lockPath = join(dir, ".alix", "ownership", "ownership.lock");
    const lock = new OwnershipLock(dir);
    await lock.acquire();
    assert.ok(existsSync(lockPath));
    lock.release();
  });
});
