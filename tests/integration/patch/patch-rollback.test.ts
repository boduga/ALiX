import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { CheckpointManager } from "../../../../dist/src/patch/checkpoint.js";

describe("Patch Rollback Integration", () => {
  const testDir = join(process.cwd(), ".test-rollback");
  let checkpointManager: CheckpointManager;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "checkpoints"), { recursive: true });
    checkpointManager = new CheckpointManager(join(testDir, "checkpoints"));
    await checkpointManager.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("restores file to checkpoint state on rollback", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original content");

    // Create checkpoint for the file
    const checkpoint = await checkpointManager.create("patch-1", [testFile]);

    // Modify the file
    await writeFile(testFile, "modified content");
    assert.equal(await readFile(testFile, "utf8"), "modified content");

    // Rollback using the checkpoint
    await checkpointManager.restore(checkpoint.id);

    // Verify file was restored to original state
    assert.equal(await readFile(testFile, "utf8"), "original content");
  });

  it("handles rollback of multiple files", async () => {
    const testFile1 = join(testDir, "file1.txt");
    const testFile2 = join(testDir, "file2.txt");
    await writeFile(testFile1, "content1");
    await writeFile(testFile2, "content2");

    // Create checkpoint manually for multiple files
    const checkpoint = await checkpointManager.create("multi-file-patch", [testFile1, testFile2]);

    // Modify both files
    await writeFile(testFile1, "modified1");
    await writeFile(testFile2, "modified2");

    // Rollback
    await checkpointManager.restore(checkpoint.id);

    // Verify both files restored
    assert.equal(await readFile(testFile1, "utf8"), "content1");
    assert.equal(await readFile(testFile2, "utf8"), "content2");
  });

  it("verifies checkpoint exists in list after creation", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original");

    const checkpoint = await checkpointManager.create("test-patch", [testFile]);

    // Verify checkpoint exists
    const checkpoints = await checkpointManager.list();
    assert.ok(checkpoints.find((c) => c.id === checkpoint.id), "Checkpoint should exist after creation");
  });

  it("lists all checkpoints", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "content");

    await checkpointManager.create("patch-1", [testFile]);
    await checkpointManager.create("patch-2", [testFile]);

    const checkpoints = await checkpointManager.list();
    assert.equal(checkpoints.length, 2);
  });

  it("deletes checkpoint", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "content");

    const checkpoint = await checkpointManager.create("patch-1", [testFile]);
    await checkpointManager.delete(checkpoint.id);

    const checkpoints = await checkpointManager.list();
    assert.equal(checkpoints.length, 0);
  });
});