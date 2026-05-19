import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { CheckpointManager } from "../../src/patch/checkpoint.js";
import { applyPatch } from "../../src/patch/patch-engine.js";

describe("Patch Events Emission", () => {
  const testDir = join(process.cwd(), ".test-patch-events");
  let eventLog: EventLog;
  let checkpointManager: CheckpointManager;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "checkpoints"), { recursive: true });
    eventLog = new EventLog(testDir);
    await eventLog.init();
    checkpointManager = new CheckpointManager(join(testDir, "checkpoints"));
    await checkpointManager.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits patch.proposed event", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original");

    await applyPatch(testDir, "search_replace", createTestPatch("test.txt", "original", "modified"), {
      eventLog,
      sessionId: "test-session",
      checkpointManager,
    });

    const events = await eventLog.readAll();
    const proposed = events.find((e) => e.type === "patch.proposed");
    assert.ok(proposed);
    assert.equal((proposed.payload as any).format, "search_replace");
  });

  it("emits patch.applied on success", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "original");

    await applyPatch(testDir, "search_replace", createTestPatch("test.txt", "original", "modified"), {
      eventLog,
      sessionId: "test-session",
      checkpointManager,
    });

    const events = await eventLog.readAll();
    const applied = events.find((e) => e.type === "patch.applied");
    assert.ok(applied);
  });

  it("emits patch.rejected on invalid patch", async () => {
    // Use structured_patch format with invalid JSON - this will cause parse failure
    const invalidPatch = `这不是有效的补丁内容`;
    await applyPatch(testDir, "structured_patch", invalidPatch, {
      eventLog,
      sessionId: "test-session",
    }).catch(() => {});

    const events = await eventLog.readAll();
    const rejected = events.find((e) => e.type === "patch.rejected");
    assert.ok(rejected);
  });
});

function createTestPatch(path: string, search: string, replace: string): string {
  return `<<<<<<< SEARCH path=${path}
${search}
=======
${replace}
>>>>>>> REPLACE`;
}