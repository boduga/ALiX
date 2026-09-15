/**
 * #713 step 2 — canonical store owns persistence AND integrity.
 *
 * Once the chain is activated, `AuditStore.append` writes v2 hash-chained
 * records and `list`/`query` normalize both v1 and v2 records, so queries keep
 * working across the activation boundary.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditStore } from "../../src/audit/audit-store.js";
import { isAuditRecordV2 } from "../../src/audit/audit-types.js";

describe("AuditStore integrity mode (#713 step 2)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "audit-integrity-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes legacy v1 records before activation", async () => {
    const store = new AuditStore(cwd);
    const rec = await store.append({ action: "policy.allowed", details: { capability: "web.search" } });
    assert.equal(isAuditRecordV2(rec), false);
    assert.ok("id" in rec);
    assert.equal((await store.list()).length, 1);
  });

  it("chains appends after activation and keeps queries working", async () => {
    const store = new AuditStore(cwd);

    // One legacy record before activation.
    await store.append({ action: "policy.allowed", details: {} });

    const activation = await store.activateIntegrity();
    assert.equal(activation.activated, true);
    assert.equal(store.integrityHead()?.seq, 1);

    // Appends after activation are v2 hash-chained.
    const rec = await store.append({ action: "runtime.blocked", details: { graphId: "g1" } });
    assert.ok(isAuditRecordV2(rec));
    assert.equal(rec.version, 2);
    assert.equal(rec.seq, 2);

    // Query layer sees both v1 and v2 records (newest-first).
    const all = await store.list();
    assert.equal(all.length, 3);
    assert.equal(all[0]!.action, "runtime.blocked");
    assert.equal(all[0]!.id, "audit_v2_2");

    // Filters still apply across the v2 records.
    const blocked = await store.findByGraph("g1");
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]!.action, "runtime.blocked");
  });

  it("verifyIntegrity reports the chain as OK after chained appends", async () => {
    const store = new AuditStore(cwd);
    await store.append({ action: "policy.evaluated", details: {} });
    await store.activateIntegrity();
    await store.append({ action: "policy.denied", details: {} });

    const result = await store.verifyIntegrity();
    assert.ok(result.ok, `Expected ok but got: ${JSON.stringify(result.findings)}`);
    assert.equal(result.recordCount.legacy, 1);
    assert.equal(result.recordCount.v2, 2);
  });

  it("activation is idempotent through the canonical store", async () => {
    const store = new AuditStore(cwd);
    const first = await store.activateIntegrity();
    const second = await store.activateIntegrity();
    assert.equal(first.activated, true);
    assert.equal(second.activated, false);
    assert.equal(store.integrityHead()?.seq, 1);
  });
});
