/**
 * approval-lifecycle.integration.test.ts — Full lifecycle integration test.
 *
 * Tests the complete approval pipeline without real daemon or LLM.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/approvals/approval-store.js";
import { computeBindingKey } from "../../src/approvals/approval-binding.js";

describe("Approval lifecycle integration", () => {
  let cwd: string;
  let store: ApprovalStore;
  let bindingKey: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "app-lifecycle-"));
    store = new ApprovalStore(cwd);
    bindingKey = computeBindingKey({
      capabilities: ["file.create"],
      requestFingerprint: "fp1",
      policyRevision: "rev1",
      coordinationRunId: "run-1",
      workerId: "w-1",
    });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("full create → approve → consume flow", async () => {
    const record = await store.requestBound({
      reason: "Need to create a file",
      bindingKey,
      requestFingerprint: "fp1",
      policyRevision: "rev1",
      capabilities: ["file.create"],
      coordinationRunId: "run-1",
      workerId: "w-1",
    });

    const resolved = await store.resolve(record.id, "approved", "Looks good");
    assert.equal(resolved?.status, "approved");

    // Wait briefly to avoid microsecond timing issues
    await new Promise(r => setTimeout(r, 10));

    const consumed = await store.consumeApproved(record.id, bindingKey, { workerId: "w-1", workerAttempt: 1 });
    assert.equal(consumed.consumed, true);
    if (consumed.consumed) {
      assert.equal(consumed.record.status, "consumed");
    }
  });

  it("binding mismatch rejects consumption", async () => {
    const record = await store.requestBound({
      reason: "test",
      bindingKey,
      requestFingerprint: "fp1",
      policyRevision: "rev1",
      capabilities: ["file.create"],
    });

    await store.resolve(record.id, "approved", "ok");
    const wrongKey = computeBindingKey({
      capabilities: ["file.create"],
      requestFingerprint: "fp2",
      policyRevision: "rev1",
    });

    const consumed = await store.consumeApproved(record.id, wrongKey, { workerId: "w-1" });
    assert.equal(consumed.consumed, false);
    assert.ok(consumed.reason.includes("binding"));
  });

  it("expired approval cannot be consumed", async () => {
    const record = await store.requestBound({
      reason: "test",
      bindingKey,
      requestFingerprint: "fp1",
      policyRevision: "rev1",
      capabilities: ["file.create"],
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
    });

    // Must approve first
    await store.resolve(record.id, "approved", "ok");

    const consumed = await store.consumeApproved(record.id, bindingKey, {});
    assert.equal(consumed.consumed, false);
    assert.ok(consumed.reason.includes("expired"));
  });

  it("revoked approval cannot be consumed", async () => {
    const record = await store.requestBound({
      reason: "test",
      bindingKey,
      requestFingerprint: "fp1",
      policyRevision: "rev1",
      capabilities: ["file.create"],
    });
    await store.resolve(record.id, "approved", "ok");
    await store.revoke(record.id, { actor: "admin", reason: "policy change" });

    const consumed = await store.consumeApproved(record.id, bindingKey, {});
    assert.equal(consumed.consumed, false);
  });

  it("expireDue marks pending past-expiry approvals", async () => {
    const record = await store.request({ reason: "test", capability: "file.create" });

    // Set expiry in the past through mutate to persist to disk
    await store.mutate((approvals) => {
      const r = approvals.find(a => a.id === record.id);
      if (r) r.expiresAt = new Date(Date.now() - 1000).toISOString();
    });

    const expired = await store.expireDue(new Date());
    assert.ok(expired.length > 0);
    assert.equal(expired[0].status, "expired");
  });
});
