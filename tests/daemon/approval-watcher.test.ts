import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalWatcher } from "../../src/daemon/approval-watcher.js";
import { ApprovalStore } from "../../src/approvals/approval-store.js";

describe("ApprovalWatcher", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "aw-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("starts and stops without error", () => {
    const watcher = new ApprovalWatcher(cwd);
    watcher.start();
    watcher.stop();
    assert.ok(true);
  });

  it("scan does not throw", async () => {
    const watcher = new ApprovalWatcher(cwd);
    // Pre-create a pending approval to ensure established cursor
    const store = new ApprovalStore(cwd);
    await store.request({ reason: "test" });
    watcher.start();
    watcher.stop();
    assert.ok(true);
  });
});
