import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RollbackExecutor } from "../../src/runtime/rollback-executor.js";
import { ReplayDiffStore } from "../../src/runtime/replay-diff-store.js";
import { buildRollbackPlan } from "../../src/runtime/rollback-plan.js";
import { EventLog } from "../../src/events/event-log.js";

describe("RollbackExecutor dry-run mode", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: RollbackExecutor;
  let diffStore: ReplayDiffStore;
  const replayId = "replay_test_dry";

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rollback-dry-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new RollbackExecutor(tmpDir, eventLog);
    diffStore = new ReplayDiffStore(tmpDir);

    const testFile = "src/test.txt";
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, testFile), "original content");
    await diffStore.captureBefore(replayId, testFile);
    writeFileSync(join(tmpDir, testFile), "modified content");
    await diffStore.captureAfter(replayId, testFile);
    await diffStore.computeDiff(replayId, testFile);
    // Persist a record in the index so loadIndex returns it
    await diffStore.appendRecord(replayId, {
      filePath: testFile,
      changeType: "modified",
      beforeSnapshotPath: join(tmpDir, ".alix", "replays", replayId, "snapshots", "before", testFile),
      afterSnapshotPath: join(tmpDir, ".alix", "replays", replayId, "snapshots", "after", testFile),
      diffPreview: "modified content",
      diffSize: 10,
      rollbackable: true,
      timestamp: new Date().toISOString(),
    });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("dry-run does not modify files", async () => {
    const diffSet = await diffStore.loadIndex(replayId);
    assert.ok(diffSet);
    const plan = buildRollbackPlan(replayId, diffSet!, "dry-run");
    const result = await executor.execute(plan);
    assert.equal(result.mode, "dry-run");
    assert.ok(result.steps.length > 0);
    const testFile = join(tmpDir, "src/test.txt");
    assert.equal(readFileSync(testFile, "utf-8"), "modified content");
  });

  it("dry-run output shows would-restore", async () => {
    const diffSet = await diffStore.loadIndex(replayId);
    assert.ok(diffSet);
    const plan = buildRollbackPlan(replayId, diffSet!, "dry-run");
    const result = await executor.execute(plan);
    const restoreStep = result.steps.find(s => s.action === "restore");
    assert.ok(restoreStep);
    assert.equal(restoreStep!.status, "completed");
    assert.ok(restoreStep!.output?.includes("[DRY-RUN]"));
  });
});

describe("RollbackExecutor approved-live mode", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: RollbackExecutor;
  let diffStore: ReplayDiffStore;
  let approvalStore: any;
  const replayId = "replay_test_live";

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rollback-live-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new RollbackExecutor(tmpDir, eventLog);
    diffStore = new ReplayDiffStore(tmpDir);

    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    approvalStore = new ApprovalStore(tmpDir);
    await approvalStore.load();

    const testFile = "src/restore-test.txt";
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, testFile), "BEFORE content");
    const beforePath = await diffStore.captureBefore(replayId, testFile);
    assert.ok(beforePath);
    writeFileSync(join(tmpDir, testFile), "AFTER content");
    await diffStore.captureAfter(replayId, testFile);
    await diffStore.computeDiff(replayId, testFile);
    // Persist a record in the index so loadIndex returns it
    await diffStore.appendRecord(replayId, {
      filePath: testFile,
      changeType: "modified",
      beforeSnapshotPath: beforePath,
      afterSnapshotPath: join(tmpDir, ".alix", "replays", replayId, "snapshots", "after", testFile),
      diffPreview: "AFTER content",
      diffSize: 10,
      rollbackable: true,
      timestamp: new Date().toISOString(),
    });

    const newFile = "src/created-test.txt";
    writeFileSync(join(tmpDir, newFile), "new file content");
    await diffStore.captureAfter(replayId, newFile);
    await diffStore.appendRecord(replayId, {
      filePath: newFile,
      changeType: "created",
      beforeSnapshotPath: undefined,
      afterSnapshotPath: join(tmpDir, ".alix", "replays", replayId, "snapshots", "after", newFile),
      diffPreview: "new file",
      diffSize: 9,
      rollbackable: false,
      timestamp: new Date().toISOString(),
    });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("restores modified file from before snapshot after approval", async () => {
    const diffSet = await diffStore.loadIndex(replayId);
    assert.ok(diffSet);
    const plan = buildRollbackPlan(replayId, diffSet!, "approved-live");

    // Execute without approval first — should be blocked
    const result1 = await executor.execute(plan, { approvalStore });
    const restoreStep1 = result1.steps.find(s => s.action === "restore");
    assert.ok(restoreStep1);

    if (restoreStep1!.status === "blocked") {
      // Resolve approvals
      const pending = approvalStore.listPending();
      for (const a of pending) {
        await approvalStore.resolve(a.id, "approved");
      }
      const result2 = await executor.execute(plan, { approvalStore });
      const restoreStep2 = result2.steps.find(s => s.action === "restore");
      assert.ok(restoreStep2);
    }

    // File should be restored to BEFORE content
    const testFile = join(tmpDir, "src/restore-test.txt");
    assert.equal(readFileSync(testFile, "utf-8"), "BEFORE content");
  });

  it("deletes created file", async () => {
    const diffSet = await diffStore.loadIndex(replayId);
    assert.ok(diffSet);
    const plan = buildRollbackPlan(replayId, diffSet!, "approved-live");

    const pending = approvalStore.listPending();
    for (const a of pending) {
      await approvalStore.resolve(a.id, "approved");
    }

    const result = await executor.execute(plan, { approvalStore });
    const deleteStep = result.steps.find(s => s.action === "delete-created");
    if (deleteStep) {
      assert.equal(deleteStep!.status, "completed");
    }

    const newFile = join(tmpDir, "src/created-test.txt");
    assert.equal(existsSync(newFile), false);
  });

  it("returns rollbackId and replayId in result", async () => {
    const diffSet = await diffStore.loadIndex(replayId);
    assert.ok(diffSet);
    const plan = buildRollbackPlan(replayId, diffSet!, "approved-live");

    const pending = approvalStore.listPending();
    for (const a of pending) {
      await approvalStore.resolve(a.id, "approved");
    }

    const result = await executor.execute(plan, { approvalStore });
    assert.ok(result.rollbackId);
    assert.equal(result.replayId, replayId);
    assert.ok(result.rollbackId.startsWith("rollback_"));
  });
});
