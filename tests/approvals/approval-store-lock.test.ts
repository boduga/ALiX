/**
 * approval-store-lock.test.ts — Tests for the per-file lock.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStoreLock } from "../../src/approvals/approval-store-lock.js";

describe("ApprovalStoreLock", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "aplock-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("acquires and releases", async () => {
    const lock = new ApprovalStoreLock(cwd);
    assert.equal(await lock.acquire(500), true);
    lock.release();
    assert.equal(lock.isHeld(), false);
  });

  it("blocks second acquisition", async () => {
    const lock1 = new ApprovalStoreLock(cwd);
    const lock2 = new ApprovalStoreLock(cwd);
    assert.equal(await lock1.acquire(500), true);
    assert.equal(await lock2.acquire(200), false);
    lock1.release();
    lock2.release();
  });

  it("acquires again after release", async () => {
    const lock = new ApprovalStoreLock(cwd);
    assert.equal(await lock.acquire(500), true);
    lock.release();
    assert.equal(await lock.acquire(500), true);
    lock.release();
  });
});
