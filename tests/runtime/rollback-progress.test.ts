import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RollbackProgressStore } from "../../src/runtime/rollback-progress.js";

describe("RollbackProgressStore", () => {
  let tmpDir: string;
  let store: RollbackProgressStore;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rollback-progress-"));
    store = new RollbackProgressStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for unknown replayId", async () => {
    const progress = await store.load("nonexistent");
    assert.equal(progress, null);
  });

  it("inits progress with running status", async () => {
    const p = await store.initProgress("replay_001", "rollback_001");
    assert.equal(p.replayId, "replay_001");
    assert.equal(p.rollbackId, "rollback_001");
    assert.equal(p.status, "running");
    assert.equal(p.lastCompletedStepIndex, -1);
    assert.deepEqual(p.completedPaths, []);
  });

  it("marks a step as completed", async () => {
    await store.markStepCompleted("replay_002", "rollback_002", 0, "src/file1.ts");
    const progress = await store.load("replay_002");
    assert.ok(progress);
    assert.equal(progress!.lastCompletedStepIndex, 0);
    assert.deepEqual(progress!.completedPaths, ["src/file1.ts"]);
  });

  it("accumulates steps without duplicates", async () => {
    await store.markStepCompleted("replay_003", "rollback_003", 0, "src/a.ts");
    await store.markStepCompleted("replay_003", "rollback_003", 1, "src/b.ts");
    await store.markStepCompleted("replay_003", "rollback_003", 1, "src/b.ts"); // duplicate
    const progress = await store.load("replay_003");
    assert.equal(progress!.lastCompletedStepIndex, 1);
    assert.equal(progress!.completedPaths.length, 2);
    assert.ok(progress!.completedPaths.includes("src/a.ts"));
    assert.ok(progress!.completedPaths.includes("src/b.ts"));
  });

  it("marks as failed", async () => {
    await store.markStepCompleted("replay_004", "rollback_004", 2, "src/ok.ts");
    await store.markFailed("replay_004", "rollback_004", "src/bad.ts");
    const progress = await store.load("replay_004");
    assert.equal(progress!.status, "failed");
    assert.equal(progress!.failedPath, "src/bad.ts");
  });

  it("marks as completed", async () => {
    await store.markCompleted("replay_005", "rollback_005");
    const progress = await store.load("replay_005");
    assert.equal(progress!.status, "completed");
  });

  it("persists to disk and reloads", async () => {
    await store.markStepCompleted("replay_persist", "rollback_persist", 0, "src/persist.ts");
    const store2 = new RollbackProgressStore(tmpDir);
    const progress = await store2.load("replay_persist");
    assert.ok(progress);
    assert.equal(progress!.completedPaths.length, 1);
  });

  it("isPathCompleted returns correct values", async () => {
    await store.markStepCompleted("replay_check", "rollback_check", 0, "src/done.ts");
    assert.equal(await store.isPathCompleted("replay_check", "src/done.ts"), true);
    assert.equal(await store.isPathCompleted("replay_check", "src/notdone.ts"), false);
  });
});
