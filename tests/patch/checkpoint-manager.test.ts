import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CheckpointManager, Checkpoint } from "../../src/patch/checkpoint-manager.js";

describe("CheckpointManager", () => {
  const testDir = join(process.cwd(), ".test-checkpoints");
  let manager: CheckpointManager;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    manager = new CheckpointManager(testDir);
    await manager.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates checkpoint for a file", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original content");
    const checkpoint = await manager.createCheckpoint(testFile);
    assert.ok(checkpoint.id);
    assert.equal(checkpoint.path, testFile);
    assert.equal(checkpoint.originalPath, testFile);
    assert.ok(checkpoint.createdAt);
    assert.ok(checkpoint.sessionId);
  });

  it("restores file from checkpoint", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original content");
    const checkpoint = await manager.createCheckpoint(testFile);
    await writeFile(testFile, "modified content");
    assert.equal(await readFile(testFile, "utf8"), "modified content");
    await manager.restore(checkpoint.id);
    assert.equal(await readFile(testFile, "utf8"), "original content");
  });

  it("lists checkpoints for session", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "content");
    const checkpoint1 = await manager.createCheckpoint(testFile);
    await writeFile(testFile, "content2");
    const checkpoint2 = await manager.createCheckpoint(testFile);
    const checkpoints = await manager.listCheckpoints();
    assert.equal(checkpoints.length, 2);
    // Checkpoints should include both created ones
    const ids = checkpoints.map((c) => c.id);
    assert.ok(ids.includes(checkpoint1.id));
    assert.ok(ids.includes(checkpoint2.id));
  });

  it("deletes checkpoint", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "content");
    const checkpoint = await manager.createCheckpoint(testFile);
    await manager.deleteCheckpoint(checkpoint.id);
    const checkpoints = await manager.listCheckpoints();
    assert.equal(checkpoints.length, 0);
  });

  it("uses provided sessionId", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "content");
    const customSessionId = "my-custom-session";
    const managerWithSession = new CheckpointManager(testDir, customSessionId);
    await managerWithSession.init();
    const checkpoint = await managerWithSession.createCheckpoint(testFile);
    assert.equal(checkpoint.sessionId, customSessionId);
  });

  it("restores original path correctly when file has moved", async () => {
    await mkdir(join(testDir, "subdir"), { recursive: true });
    const originalFile = join(testDir, "subdir", "original.txt");
    await writeFile(originalFile, "original content");
    const checkpoint = await manager.createCheckpoint(originalFile);
    // Modify the file
    await writeFile(originalFile, "modified content");
    await manager.restore(checkpoint.id);
    // Restore should put the checkpointed content back at original path
    assert.equal(await readFile(originalFile, "utf8"), "original content");
  });

  it("throws error when restoring non-existent checkpoint", async () => {
    await assert.rejects(
      async () => {
        await manager.restore("non-existent-id");
      },
      (err: Error) => {
        return err.message.includes("not found") || err.message.includes("does not exist");
      }
    );
  });

  it("throws error when deleting non-existent checkpoint", async () => {
    await assert.rejects(
      async () => {
        await manager.deleteCheckpoint("non-existent-id");
      },
      (err: Error) => {
        return err.message.includes("not found") || err.message.includes("does not exist");
      }
    );
  });
});