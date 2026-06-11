import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplayLock } from "../../src/runtime/replay-lock.js";

describe("ReplayLock", () => {
  let tmpDir: string;
  let lock: ReplayLock;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "replay-lock-"));
    lock = new ReplayLock(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("acquires a lock on first attempt", async () => {
    const acquired = await lock.acquire("replay_001", "rollback");
    assert.equal(acquired, true);
  });

  it("fails to acquire an already-held lock", async () => {
    await lock.acquire("replay_002", "rollback");
    const acquired = await lock.acquire("replay_002", "rollback");
    assert.equal(acquired, false);
  });

  it("releases a lock", async () => {
    await lock.acquire("replay_003", "rollback");
    await lock.release("replay_003");
    const acquired = await lock.acquire("replay_003", "rollback");
    assert.equal(acquired, true);
  });

  it("isLocked returns true for held lock", async () => {
    await lock.acquire("replay_004", "replay");
    assert.equal(await lock.isLocked("replay_004"), true);
    await lock.release("replay_004");
    assert.equal(await lock.isLocked("replay_004"), false);
  });

  it("getLockInfo returns lock details", async () => {
    await lock.acquire("replay_005", "rollback");
    const info = await lock.getLockInfo("replay_005");
    assert.ok(info);
    assert.equal(info!.replayId, "replay_005");
    assert.equal(info!.operation, "rollback");
    assert.ok(info!.pid > 0);
    assert.ok(info!.hostname);
    assert.ok(info!.acquiredAt);
    await lock.release("replay_005");
  });

  it("returns null for non-existent lock info", async () => {
    const info = await lock.getLockInfo("nonexistent");
    assert.equal(info, null);
  });

  it("forceRelease removes a held lock", async () => {
    await lock.acquire("replay_006", "rollback");
    await lock.forceRelease("replay_006");
    assert.equal(await lock.isLocked("replay_006"), false);
  });

  it("isStale returns false for fresh lock", async () => {
    await lock.acquire("replay_stale_fresh", "rollback");
    assert.equal(await lock.isStale("replay_stale_fresh", 60000), false);
    await lock.release("replay_stale_fresh");
  });

  it("isStale returns true for expired lock", async () => {
    await lock.acquire("replay_stale_old", "rollback");
    // Manually set a very old timestamp
    const lockDir = join(tmpDir, ".alix", "replays", "replay_stale_old");
    const lockFile = join(lockDir, ".lock");
    writeFileSync(lockFile, JSON.stringify({
      pid: 0, hostname: "old", replayId: "replay_stale_old",
      operation: "rollback", acquiredAt: new Date(Date.now() - 120_000).toISOString(),
    }));
    assert.equal(await lock.isStale("replay_stale_old", 1000), true);
  });

  it("acquires lock after stale release", async () => {
    await lock.acquire("replay_stale_acquire", "rollback");
    const lockDir = join(tmpDir, ".alix", "replays", "replay_stale_acquire");
    const lockFile = join(lockDir, ".lock");
    writeFileSync(lockFile, JSON.stringify({
      pid: 0, hostname: "old", replayId: "replay_stale_acquire",
      operation: "rollback", acquiredAt: new Date(Date.now() - 120_000).toISOString(),
    }));
    // Should auto forceRelease and acquire
    const acquired = await lock.acquire("replay_stale_acquire", "rollback");
    assert.equal(acquired, true);
  });

  it("cleanupStale removes expired locks", async () => {
    await lock.acquire("replay_clean_a", "rollback");
    // Force old timestamp
    const dirA = join(tmpDir, ".alix", "replays", "replay_clean_a");
    writeFileSync(join(dirA, ".lock"), JSON.stringify({
      pid: 0, hostname: "old", replayId: "replay_clean_a",
      operation: "rollback", acquiredAt: new Date(Date.now() - 60_000).toISOString(),
    }));
    await lock.acquire("replay_clean_b", "rollback");
    const cleaned = await lock.cleanupStale(1000);
    assert.ok(cleaned.includes("replay_clean_a"));
    // replay_clean_b was just acquired — not stale
    assert.ok(!cleaned.includes("replay_clean_b"));
    await lock.release("replay_clean_b");
  });
});
