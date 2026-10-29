import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OwnershipLock } from "../../src/coordination/ownership/ownership-lock.js";

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
    assert.equal(await lock.acquire(), true);
    assert.equal(lock.isHeld, true);
    lock.release();
    assert.equal(lock.isHeld, false);
  });

  it("blocks another acquisition while held", async () => {
    const lockA = new OwnershipLock(dir);
    const lockB = new OwnershipLock(dir);
    assert.equal(await lockA.acquire(), true);
    assert.equal(await lockB.acquire(250), false);
    lockA.release();
    lockB.release();
  });

  it("a successor acquires after release", async () => {
    const lockA = new OwnershipLock(dir);
    const lockB = new OwnershipLock(dir);
    assert.equal(await lockA.acquire(), true);
    lockA.release();
    assert.equal(await lockB.acquire(500), true);
    lockB.release();
  });

  it("creates the ownership lock target", async () => {
    const lock = new OwnershipLock(dir);
    assert.equal(await lock.acquire(), true);
    assert.ok(existsSync(join(dir, ".alix", "ownership", "ownership.lock")));
    lock.release();
  });

  it("mkdir fallback never steals an old lock from a live owner", async () => {
    const held = new OwnershipLock(dir, { backend: "mkdir" });
    assert.equal(await held.acquire(500), true);
    const metaPath = join(dir, ".alix", "ownership", "ownership.lock", "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    writeFileSync(metaPath, JSON.stringify({
      ...meta,
      acquiredAt: new Date(Date.now() - 600_000).toISOString(),
    }));

    const contender = new OwnershipLock(dir, { backend: "mkdir" });
    assert.equal(await contender.acquire(250), false);
    held.release();
    contender.release();
  });

  it("mkdir fallback reclaims a provably dead owner", async () => {
    const held = new OwnershipLock(dir, { backend: "mkdir" });
    assert.equal(await held.acquire(500), true);
    const metaPath = join(dir, ".alix", "ownership", "ownership.lock", "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    writeFileSync(metaPath, JSON.stringify({ ...meta, pid: 2 ** 30 }));

    const successor = new OwnershipLock(dir, { backend: "mkdir" });
    assert.equal(await successor.acquire(1_000), true);
    successor.release();
  });

  it("release is idempotent", async () => {
    const lock = new OwnershipLock(dir);
    assert.equal(await lock.acquire(), true);
    lock.release();
    lock.release();
    assert.equal(lock.isHeld, false);
  });
});
