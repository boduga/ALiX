import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplayDiffStore, isRollbackable } from "../../src/runtime/replay-diff-store.js";

describe("ReplayDiffStore", () => {
  let tmpDir: string;
  let store: ReplayDiffStore;
  const replayId = "replay_test_001";

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "diff-store-test-"));
    store = new ReplayDiffStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures before snapshot of existing file", async () => {
    const filePath = "src/test.txt";
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, filePath), "before content");
    const result = await store.captureBefore(replayId, filePath);
    assert.ok(result);
    assert.ok(result!.includes(replayId));
    assert.ok(result!.includes("before"));
    assert.ok(result!.includes(filePath));
    assert.ok(existsSync(result!));
    assert.equal(readFileSync(result!, "utf-8"), "before content");
  });

  it("captureBefore returns null for non-existent file", async () => {
    const result = await store.captureBefore(replayId, "nonexistent/file.txt");
    assert.equal(result, null);
  });

  it("captures after snapshot of existing file", async () => {
    const filePath = "src/after-test.txt";
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, filePath), "after content");
    const result = await store.captureAfter(replayId, filePath);
    assert.ok(result);
    assert.equal(readFileSync(result!, "utf-8"), "after content");
  });

  it("computes diff between before and after snapshots", async () => {
    const filePath = "src/diff-test.txt";
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, filePath), "line one\nline two\nline three");
    await store.captureBefore(replayId, filePath);
    writeFileSync(join(tmpDir, filePath), "line one\nline two modified\nline three\nline four");
    await store.captureAfter(replayId, filePath);
    const diff = await store.computeDiff(replayId, filePath);
    assert.ok(diff);
    assert.ok(diff.includes("line two") || diff.includes("line four"));
  });

  it("builds and persists an index.json", async () => {
    const filePath = "src/index-test.txt";
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, filePath), "before");
    const beforePath = await store.captureBefore(replayId, filePath);
    writeFileSync(join(tmpDir, filePath), "after");
    const afterPath = await store.captureAfter(replayId, filePath);
    const diff = await store.computeDiff(replayId, filePath);
    await store.appendRecord(replayId, {
      filePath,
      changeType: "modified",
      beforeSnapshotPath: beforePath || undefined,
      afterSnapshotPath: afterPath || undefined,
      diffPreview: diff.slice(0, 2000),
      diffSize: diff.length,
      rollbackable: beforePath !== null,
      timestamp: new Date().toISOString(),
    });
    const loaded = await store.loadIndex(replayId);
    assert.ok(loaded);
    assert.equal(loaded!.replayId, replayId);
    assert.equal(loaded!.records.length, 1);
    assert.equal(loaded!.records[0].filePath, filePath);
    assert.equal(loaded!.records[0].changeType, "modified");
    assert.equal(loaded!.records[0].rollbackable, true);
  });

  it("records created file as non-rollbackable", async () => {
    const filePath = "new-file.txt";
    writeFileSync(join(tmpDir, filePath), "new content");
    const afterPath = await store.captureAfter(replayId, filePath);
    await store.appendRecord(replayId, {
      filePath,
      changeType: "created",
      beforeSnapshotPath: undefined,
      afterSnapshotPath: afterPath || undefined,
      diffPreview: "new file",
      diffSize: 9,
      rollbackable: false,
      timestamp: new Date().toISOString(),
    });
    const loaded = await store.loadIndex(replayId);
    assert.ok(loaded);
    const record = loaded!.records.find(r => r.filePath === filePath);
    assert.ok(record);
    assert.equal(record!.changeType, "created");
    assert.equal(record!.rollbackable, false);
  });

  it("isRollbackable returns correct values", () => {
    assert.equal(isRollbackable("modified", true), true);
    assert.equal(isRollbackable("deleted", true), true);
    assert.equal(isRollbackable("created", true), false);
    assert.equal(isRollbackable("created", false), false);
  });
});
