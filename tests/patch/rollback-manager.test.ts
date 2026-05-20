import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
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
});
