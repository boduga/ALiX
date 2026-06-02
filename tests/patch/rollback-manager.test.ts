import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RollbackManager } from "../../src/patch/rollback-manager.js";

describe("RollbackManager", () => {
  let manager: RollbackManager;

  beforeEach(() => {
    manager = new RollbackManager({ maxSnapshots: 10 });
  });

  it("saves snapshots before changes", async () => {
    await manager.snapshot("test.txt", "original content");
    const snapshot = await manager.getSnapshot("test.txt");
    assert.equal(snapshot?.content, "original content");
  });

  it("restores previous version", async () => {
    await manager.snapshot("test.txt", "version 1");
    await manager.snapshot("test.txt", "version 2");

    const restored = await manager.rollback("test.txt", 1);
    assert.equal(restored, "version 1");
  });

  it("prunes old snapshots beyond limit", async () => {
    for (let i = 0; i < 15; i++) {
      await manager.snapshot("test.txt", `version ${i}`);
    }

    const snapshots = await manager.listSnapshots("test.txt");
    assert.ok(snapshots.length <= 10);
  });

  it("clears snapshots on commit", async () => {
    await manager.snapshot("test.txt", "content");
    await manager.commit("test.txt");

    const snapshots = await manager.listSnapshots("test.txt");
    assert.equal(snapshots.length, 0);
  });

  it("returns null when getting snapshot for unknown file", async () => {
    const snapshot = await manager.getSnapshot("nonexistent.txt");
    assert.equal(snapshot, null);
  });

  it("returns null when rolling back beyond available snapshots", async () => {
    await manager.snapshot("test.txt", "v1");
    const result = await manager.rollback("test.txt", 5);
    assert.equal(result, null);
  });

  it("getMetadata returns correct metadata", async () => {
    await manager.snapshot("test.txt", "v1");
    await manager.snapshot("test.txt", "v2");
    const meta = await manager.getMetadata("test.txt");
    assert.ok(meta !== null);
    assert.equal(meta!.snapshotCount, 2);
    assert.ok(meta!.oldestSnapshot instanceof Date);
    assert.ok(meta!.newestSnapshot instanceof Date);
  });

  it("getMetadata returns null for unknown file", async () => {
    const meta = await manager.getMetadata("nonexistent.txt");
    assert.equal(meta, null);
  });

  it("clear removes all snapshots", async () => {
    await manager.snapshot("a.txt", "content a");
    await manager.snapshot("b.txt", "content b");
    await manager.clear();
    const a = await manager.listSnapshots("a.txt");
    const b = await manager.listSnapshots("b.txt");
    assert.equal(a.length, 0);
    assert.equal(b.length, 0);
  });

  it("getSnapshot with version retrieves specific version", async () => {
    await manager.snapshot("test.txt", "v1");
    await manager.snapshot("test.txt", "v2");
    await manager.snapshot("test.txt", "v3");

    // version 1 = most recent (v3), version 2 = one before (v2), version 3 = oldest (v1)
    assert.equal((await manager.getSnapshot("test.txt", 1))?.content, "v3");
    assert.equal((await manager.getSnapshot("test.txt", 2))?.content, "v2");
    assert.equal((await manager.getSnapshot("test.txt", 3))?.content, "v1");
  });
});