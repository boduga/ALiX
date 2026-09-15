/**
 * #713 step 1 — AuditEventStore conformance.
 *
 * Both domain stores implement the canonical persistence contract
 * (src/audit/audit-contract.ts). This pins the seam so the runtime store and
 * the governance store cannot drift into separate persistence shapes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuditStore, type AuditAppendInput } from "../../src/audit/audit-store.js";
import type { AuditRecord } from "../../src/audit/audit-types.js";
import type { AuditEventStore } from "../../src/audit/audit-contract.js";
import { FileAuditStore } from "../../src/governance/audit-store.js";
import type {
  GovernanceAuditEvent,
  GovernanceAuditEventInput,
} from "../../src/governance/audit-types.js";

function validGovernanceInput(): GovernanceAuditEventInput {
  return {
    eventId: "aud-contract-001",
    timestamp: "2026-07-06T14:00:00.000Z",
    eventType: "policy_evaluated",
    actorType: "policy_engine",
    actorId: "engine-v1",
    subjectType: "policy",
    subjectId: "pol-auto-approve",
    action: "evaluate_run_risk",
    decision: "allowed",
    policyId: "run-approval-policy",
    policyVersion: "1.2",
    ruleId: null,
    reason: "Run risk below threshold",
    evidenceRefs: ["sig-risk-001"],
    requestId: null,
    traceId: null,
    sessionId: null,
    parentEventId: null,
    riskLevel: "low",
    requiresHumanReview: false,
    metadata: {},
  };
}

describe("AuditEventStore conformance (#713 step 1)", () => {
  it("runtime AuditStore implements the contract and round-trips", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-contract-"));
    try {
      const store: AuditEventStore<AuditAppendInput, AuditRecord> = new AuditStore(dir);
      const rec = await store.append({ action: "policy.allowed", details: {} });
      assert.equal(rec.action, "policy.allowed");
      const all = await store.list();
      assert.equal(all.length, 1);
      assert.equal(all[0]!.id, rec.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("governance FileAuditStore implements the contract and round-trips", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gov-audit-contract-"));
    try {
      const store: AuditEventStore<GovernanceAuditEventInput, GovernanceAuditEvent> =
        new FileAuditStore(dir);
      const ev = await store.append(validGovernanceInput());
      assert.equal(ev.eventId, "aud-contract-001");
      assert.equal(ev.previousHash, null);
      const all = await store.list();
      assert.equal(all.length, 1);
      assert.equal(all[0]!.eventId, ev.eventId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
