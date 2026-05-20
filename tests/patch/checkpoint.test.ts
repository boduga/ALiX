import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CheckpointManager } from "../../src/patch/checkpoint.js";

describe("CheckpointManager", () => {
  const testDir = join("/tmp", `.test-checkpoints-${Date.now()}`);
  let manager: CheckpointManager;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    manager = new CheckpointManager(testDir);
    await manager.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates checkpoint with files", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original content");
    const checkpoint = await manager.create("patch-1", [testFile]);
    assert.ok(checkpoint.id);
    assert.equal(checkpoint.files.length, 1);
    assert.equal(checkpoint.files[0], testFile);
  });

  it("restores checkpoint to original state", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original content");
    const checkpoint = await manager.create("patch-1", [testFile]);
    await writeFile(testFile, "modified content");
    assert.equal(await readFile(testFile, "utf8"), "modified content");
    await manager.restore(checkpoint.id);
    assert.equal(await readFile(testFile, "utf8"), "original content");
  });

  it("lists checkpoints", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "content");
    await manager.create("patch-1", [testFile]);
    await manager.create("patch-2", [testFile]);
    const checkpoints = await manager.list();
    assert.equal(checkpoints.length, 2);
  });

  it("deletes checkpoint", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "content");
    const checkpoint = await manager.create("patch-1", [testFile]);
    await manager.delete(checkpoint.id);
    const checkpoints = await manager.list();
    assert.equal(checkpoints.length, 0);
  });
});