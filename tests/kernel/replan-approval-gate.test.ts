/**
 * replan-approval-gate.test.ts — Tests for ReplanApprovalGate.
 *
 * Coverage:
 * - Fresh approval: new record created when no pending exists
 * - Reuse pending: existing pending returned when binding key matches
 * - Consumed exactly once: consumeApproved succeeds and second call fails
 * - Stale proposal rejected: consumeApproved fails for changed binding key
 * - Denial blocks apply: denied approval cannot be consumed
 * - Low-risk auto-approved: no approval record created
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/approvals/approval-store.js";
import { ReplanApprovalGate } from "../../src/kernel/replan-approval-gate.js";
import { computeFingerprint } from "../../src/kernel/replan-types.js";
import type { ImpactAnalysis } from "../../src/kernel/replan-types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function freshEnvironment(): {
  store: ApprovalStore;
  gate: ReplanApprovalGate;
  cleanup: () => void;
} {
  const tmpDir = mkdtempSync(join(tmpdir(), "replan-approval-gate-test-"));
  const store = new ApprovalStore(tmpDir);
  const gate = new ReplanApprovalGate(store);
  return {
    store,
    gate,
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function makeImpactAnalysis(overrides?: Partial<ImpactAnalysis>): ImpactAnalysis {
  return {
    riskLevel: "medium",
    agentsAssigned: 1,
    capabilitiesAdded: [],
    capabilitiesRemoved: [],
    ownershipChanges: [],
    activeLeaseConflicts: [],
    protectedScopeViolations: [],
    policyDecisions: [],
    requiresApproval: true,
    summary: "Test impact analysis",
    ...overrides,
  };
}

/** Compute the exact binding key the gate would use for a given set of inputs. */
function expectedBindingKey(
  runId: string,
  draftFingerprint: string,
  impactFingerprint: string,
  expectedPlanRevision: number,
): string {
  return computeFingerprint({
    kind: "model_assisted_replan",
    runId,
    expectedPlanRevision,
    draftFingerprint,
    impactFingerprint,
    policyRevision: "current",
    capabilities: ["coordination.plan.revise"],
  });
}

describe("ReplanApprovalGate", () => {
  const RUN_ID = "coord_test-run-123";
  const DRAFT_FINGERPRINT = "abc123def456";
  const IMPACT_FINGERPRINT = "789ghi";
  const PLAN_REVISION = 0;

  describe("evaluate", () => {
    it("returns auto-approved when no approval is required", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ requiresApproval: false, riskLevel: "low" });
        const result = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);

        assert.equal(result.approved, true);
        assert.equal(result.autoApproved, true);
        assert.equal(result.approvalId, undefined);
        assert.equal(result.record, undefined);
        assert.equal(result.reason, "Impact analysis determined no approval is required");
      } finally {
        cleanup();
      }
    });

    it("creates a fresh approval for medium risk when no pending exists", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ riskLevel: "medium" });
        const result = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);

        assert.equal(result.approved, false); // pending, not approved yet
        assert.equal(result.autoApproved, false);
        assert.ok(result.approvalId, "should have an approval ID");
        assert.ok(result.record, "should have a record");
        assert.equal(result.record!.status, "pending");
        assert.ok(result.record!.bindingKey.length > 0, "binding key should be non-empty");
        assert.deepEqual(result.record!.capabilities, ["coordination.plan.revise"]);
        assert.equal(result.record!.coordinationRunId, RUN_ID);
        assert.equal(result.record!.riskLevel, "medium");
      } finally {
        cleanup();
      }
    });

    it("reuses an existing pending approval with the same binding key", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ riskLevel: "high" });

        // First call creates a pending approval
        const first = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        assert.equal(first.record!.status, "pending");

        // Second call with identical params reuses the same pending
        const second = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        assert.equal(second.record!.status, "pending");
        assert.equal(second.approvalId, first.approvalId);
        assert.equal(second.record!.id, first.record!.id);
        assert.equal(
          second.record!.requestFingerprint,
          first.record!.requestFingerprint,
          "should reuse the original record's fields, not create new ones",
        );
      } finally {
        cleanup();
      }
    });

    it("creates a distinct approval for a different binding key", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ riskLevel: "medium" });

        const result1 = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        const result2 = await gate.evaluate(analysis, "coord_other-run", DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);

        assert.notEqual(result1.approvalId, result2.approvalId);
        assert.notEqual(result1.record!.bindingKey, result2.record!.bindingKey);
      } finally {
        cleanup();
      }
    });

    it("returns already-approved status when the stored approval was resolved", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ riskLevel: "critical" });

        // Create the approval
        const created = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        assert.ok(created.approvalId);

        // Resolve it to approved
        const resolved = await store.resolve(created.approvalId!, "approved", "Looks good");
        assert.equal(resolved!.status, "approved");

        // Re-evaluate — should find the now-approved record
        const checked = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        assert.equal(checked.approved, true);
        assert.equal(checked.record!.status, "approved");
      } finally {
        cleanup();
      }
    });
  });

  describe("checkApproval", () => {
    it("returns not-found for unknown approval ID", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const result = await gate.checkApproval("nonexistent");

        assert.equal(result.approved, false);
        assert.ok(result.reason.includes("not found"));
      } finally {
        cleanup();
      }
    });

    it("returns the current status of the approval", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ riskLevel: "medium" });
        const created = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        assert.ok(created.approvalId);

        const result = await gate.checkApproval(created.approvalId!);
        assert.equal(result.approved, false);
        assert.equal(result.record!.status, "pending");
      } finally {
        cleanup();
      }
    });

    it("returns approved after the record is resolved", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ riskLevel: "medium" });
        const created = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        await store.resolve(created.approvalId!, "approved");

        const result = await gate.checkApproval(created.approvalId!);
        assert.equal(result.approved, true);
        assert.equal(result.record!.status, "approved");
      } finally {
        cleanup();
      }
    });
  });

  describe("consumeApproved", () => {
    it("consumes an approved approval exactly once", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ riskLevel: "high" });
        const created = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        assert.ok(created.approvalId);

        // Approve it
        await store.resolve(created.approvalId!, "approved");

        const bindingKey = expectedBindingKey(RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);

        // First consume should succeed (2 args — no coordinationRunId)
        const first = await gate.consumeApproved(created.approvalId!, bindingKey);
        assert.equal(first.consumed, true);
        if (first.consumed) {
          assert.equal(first.record.status, "consumed");
        }

        // Second consume should fail — already consumed
        const second = await gate.consumeApproved(created.approvalId!, bindingKey);
        assert.equal(second.consumed, false);
        assert.ok(second.reason);
      } finally {
        cleanup();
      }
    });

    it("rejects consumption when binding key does not match", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ riskLevel: "high" });
        const created = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        await store.resolve(created.approvalId!, "approved");

        // Wrong binding key should fail
        const result = await gate.consumeApproved(
          created.approvalId!,
          "wrong-binding-key",
        );
        assert.equal(result.consumed, false);
        assert.ok(result.reason);
      } finally {
        cleanup();
      }
    });

    it("rejects consumption when approval is denied", async () => {
      const { store, gate, cleanup } = freshEnvironment();
      try {
        await store.load();
        const analysis = makeImpactAnalysis({ riskLevel: "high" });
        const created = await gate.evaluate(analysis, RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        assert.ok(created.approvalId);

        // Deny it
        await store.resolve(created.approvalId!, "denied", "Not approved");

        const bindingKey = expectedBindingKey(RUN_ID, DRAFT_FINGERPRINT, IMPACT_FINGERPRINT, PLAN_REVISION);
        const result = await gate.consumeApproved(created.approvalId!, bindingKey);
        assert.equal(result.consumed, false);
      } finally {
        cleanup();
      }
    });
  });
});
