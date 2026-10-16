/**
 * SRAP-1 audit-owned idempotent remote-decision projection.
 *
 * Covers idempotent re-run, duplicate drop, crash-before-checkpoint overlap
 * (absent and stale state), malformed-evidence refusal, fail-closed on an
 * unverifiable chain, and the lag counter.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import type { ApprovalRequestInput } from "../../src/governance/approvals/approval-store.js";
import { remoteDecisionRetryKey } from "../../src/governance/approvals/approval-types.js";
import type { RemoteDecisionEvidence } from "../../src/governance/approvals/approval-types.js";
import { AuditStore } from "../../src/governance/audit/audit-store.js";
import { projectRemoteDecisions } from "../../src/governance/audit/remote-decision-projection.js";
import { closeAllSharedLedgers } from "../../src/runtime-state/storage/runtime-ledger.js";

function evidence(over: Partial<RemoteDecisionEvidence> = {}): RemoteDecisionEvidence {
  return {
    decisionId: "dec-1",
    principalId: "principal-A",
    credentialRef: "hmac-sha256:v1:AAAA",
    decision: "approved",
    nonce: "nonce-1",
    decidedAt: new Date().toISOString(),
    transport: "direct-tls",
    ...over,
  };
}

async function storeWithDecision(cwd: string, e: RemoteDecisionEvidence): Promise<string> {
  const store = new ApprovalStore(cwd);
  await store.load();
  const input: ApprovalRequestInput = {
    reason: "test",
    bindingKey: "bk-" + e.decisionId,
    requestFingerprint: "fp",
    policyRevision: "legacy",
    capabilities: ["shell.run"],
  };
  const rec = await store.requestBound(input);
  await store.resolveWithEvidence(rec.id, e.decision, e);
  return rec.id;
}

describe("remote-decision projection", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "srap-proj-"));
  });

  afterEach(() => {
    closeAllSharedLedgers();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("projects a committed decision once and is idempotent on re-run", async () => {
    await new AuditStore(cwd).activateIntegrity();
    await storeWithDecision(cwd, evidence());

    const first = await projectRemoteDecisions(cwd);
    assert.ok(first.ok);
    assert.equal(first.counters.projected, 1);
    assert.equal(first.counters.skipped_duplicate, 0);

    const second = await projectRemoteDecisions(cwd);
    assert.ok(second.ok);
    assert.equal(second.counters.projected, 0, "re-run projects nothing new");
    assert.equal(second.counters.skipped_duplicate, 1, "the decision is seen as a duplicate");
  });

  it("drops duplicates by decisionId across two approvals", async () => {
    await new AuditStore(cwd).activateIntegrity();
    // Two decisions sharing the SAME decisionId (a retry that slipped through).
    await storeWithDecision(cwd, evidence({ decisionId: "dup", nonce: "n1" }));
    await storeWithDecision(cwd, evidence({ decisionId: "dup", nonce: "n2" }));

    const r = await projectRemoteDecisions(cwd);
    assert.ok(r.ok);
    assert.equal(r.counters.projected, 1, "only the first decisionId is projected");
    assert.equal(r.counters.skipped_duplicate, 1);
  });

  it("reports positive lag while backlog is unprojected, zero after projecting", async () => {
    await new AuditStore(cwd).activateIntegrity();
    await storeWithDecision(cwd, evidence());

    const first = await projectRemoteDecisions(cwd);
    assert.ok(first.counters.lag > 0, "unprojected ledger events → positive lag");
    assert.ok(first.ok);

    const again = await projectRemoteDecisions(cwd);
    assert.equal(again.counters.lag, 0, "fully projected → zero lag");
  });

  it("refuses an unactivated (unverified) audit log", async () => {
    // A decision exists but integrity was never activated → no tamper-evidence.
    await storeWithDecision(cwd, evidence());
    const r = await projectRemoteDecisions(cwd);
    assert.equal(r.ok, false);
    assert.ok(r.refused);
    assert.equal(r.counters.projected, 0);
  });

  it("absorbed crash-before-checkpoint: no state file → full re-scan, dedup drops it", async () => {
    await new AuditStore(cwd).activateIntegrity();
    await storeWithDecision(cwd, evidence({ decisionId: "dec-crash" }));

    // Simulate a crash before the projection state was ever persisted: project
    // once, then remove the advisory state so the next run re-scans from zero.
    const first = await projectRemoteDecisions(cwd);
    assert.equal(first.counters.projected, 1);
    rmSync(join(cwd, ".alix", "audit", "projection-state.json"), { force: true });

    // Re-run from scratch: the audit chain already holds the record, so the
    // decision must be dropped as a duplicate, not re-appended.
    const before = (await new AuditStore(cwd).list(1000)).length;
    const second = await projectRemoteDecisions(cwd);
    const after = (await new AuditStore(cwd).list(1000)).length;
    assert.equal(second.counters.projected, 0, "no re-append after state loss");
    assert.equal(second.counters.skipped_duplicate, 1);
    assert.equal(after, before, "audit record count is unchanged");
  });

  it("a stale pre-crash cursor re-scans via the overlap window and dedups", async () => {
    await new AuditStore(cwd).activateIntegrity();
    await storeWithDecision(cwd, evidence({ decisionId: "dec-stale" }));
    const first = await projectRemoteDecisions(cwd);
    assert.equal(first.counters.projected, 1);

    // Crash AFTER the decision was projected but BEFORE the checkpoint persisted:
    // the advisory cursor is still 0 (non-zero-but-stale is the case the
    // bounded overlap window exists to absorb).
    writeFileSync(
      join(cwd, ".alix", "audit", "projection-state.json"),
      JSON.stringify({ cursor: 0, decisionIds: [] }),
      "utf-8",
    );

    const before = (await new AuditStore(cwd).list(1000)).length;
    const second = await projectRemoteDecisions(cwd);
    const after = (await new AuditStore(cwd).list(1000)).length;
    assert.equal(second.counters.projected, 0, "chain-seeded dedup drops the re-seen decision");
    assert.equal(second.counters.skipped_duplicate, 1);
    assert.equal(after, before, "no duplicate audit record");
  });

  it("counts malformed evidence as a projection failure and holds the cursor", async () => {
    await new AuditStore(cwd).activateIntegrity();
    const store = new ApprovalStore(cwd);
    await store.load();
    const rec = await store.requestBound({
      reason: "test", bindingKey: "bk-bad", requestFingerprint: "fp",
      policyRevision: "legacy", capabilities: ["shell.run"],
    });
    // A broken producer writes an `approval.updated` whose evidence is missing
    // a required field. It must NOT be silently skipped.
    const broken = { ...evidence(), nonce: undefined } as unknown as RemoteDecisionEvidence;
    await store.resolveWithEvidence(rec.id, "approved", broken);

    const first = await projectRemoteDecisions(cwd);
    assert.equal(first.ok, false);
    assert.equal(first.counters.projection_failed, 1);
    assert.equal(first.counters.projected, 0);

    // The cursor did not advance past the malformed event: re-running re-attempts
    // it (evidence is never durably acknowledged without being projected).
    const second = await projectRemoteDecisions(cwd);
    assert.equal(second.counters.projection_failed, 1, "cursor held; evidence re-attempted");
  });

  it("fails closed when the audit chain is not verifiable", async () => {
    await new AuditStore(cwd).activateIntegrity();
    await storeWithDecision(cwd, evidence());
    // Corrupt the chain tail.
    appendFileSync(join(cwd, ".alix", "audit", "audit.jsonl"), '{"version":2,"seq":99,"prevHash":', "utf-8");

    const r = await projectRemoteDecisions(cwd);
    assert.equal(r.ok, false);
    assert.ok(r.refused);
    assert.equal(r.counters.projected, 0, "nothing projected from an unverified chain");
  });

  it("exact-retry identity is principalId + nonce + decision (order-independent of other fields)", () => {
    const base = evidence({ principalId: "p1", nonce: "n1", decision: "approved" });
    assert.equal(
      remoteDecisionRetryKey(base),
      remoteDecisionRetryKey(evidence({ principalId: "p1", nonce: "n1", decision: "approved", decidedAt: "1999-01-01T00:00:00Z", transport: "proxy-tls" })),
      "non-identity fields must not affect the retry key",
    );
    assert.notEqual(
      remoteDecisionRetryKey(base),
      remoteDecisionRetryKey(evidence({ principalId: "p1", nonce: "n2", decision: "approved" })),
    );
    assert.notEqual(
      remoteDecisionRetryKey(base),
      remoteDecisionRetryKey(evidence({ principalId: "p1", nonce: "n1", decision: "denied" })),
    );
  });

  it("no remote evidence → no projection, still ok", async () => {
    await new AuditStore(cwd).activateIntegrity();
    const store = new ApprovalStore(cwd);
    await store.load();
    const rec = await store.requestBound({
      reason: "local", bindingKey: "bk-local", requestFingerprint: "fp",
      policyRevision: "legacy", capabilities: ["shell.run"],
    });
    await store.resolve(rec.id, "approved", "cli");

    const r = await projectRemoteDecisions(cwd);
    assert.ok(r.ok);
    assert.equal(r.counters.projected, 0);
  });
});
