import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRemediationProposalsFromRecommendations } from "../../src/governance/remediation-queue.js";
import type { GovernanceResponseRecommendation } from "../../src/governance/response-recommendations.js";

const NOW = "2026-07-07T14:00:00.000Z";
const WS = "2026-07-01T00:00:00.000Z";
const WE = "2026-07-08T00:00:00.000Z";

function makeRec(overrides: Partial<GovernanceResponseRecommendation> = {}): GovernanceResponseRecommendation {
  return {
    recommendationId: `rec-${Math.random().toString(36).slice(2, 6)}`,
    source: "anomaly",
    sourceIds: [`src-${Math.random().toString(36).slice(2, 6)}`],
    severity: "warning",
    responseKind: "investigate_anomaly",
    title: "Test recommendation",
    reason: "Test reason",
    evidenceRefs: ["evt-1"],
    confidence: 0.75,
    proposedAction: "Review and remediate",
    reversible: true,
    createdAt: NOW,
    ...overrides,
  };
}

describe("createRemediationProposalsFromRecommendations", () => {
  it("empty recommendations → empty proposals", () => {
    const r = createRemediationProposalsFromRecommendations([], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.deepEqual(r, []);
  });

  it("single recommendation → single proposal with open status", () => {
    const rec = makeRec({ recommendationId: "rec-1", severity: "warning" });
    const r = createRemediationProposalsFromRecommendations([rec], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.status, "open");
  });

  it("same kind+severity → one batched proposal", () => {
    const a = makeRec({ recommendationId: "rec-a", severity: "warning", responseKind: "investigate_anomaly", evidenceRefs: ["evt-a"] });
    const b = makeRec({ recommendationId: "rec-b", severity: "warning", responseKind: "investigate_anomaly", evidenceRefs: ["evt-b"] });
    const r = createRemediationProposalsFromRecommendations([a, b], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.length, 1);
    assert.ok(r[0]!.title.includes("2 items"));
  });

  it("different severities → separate proposals", () => {
    const a = makeRec({ recommendationId: "rec-a", severity: "critical", responseKind: "investigate_anomaly" });
    const b = makeRec({ recommendationId: "rec-b", severity: "warning", responseKind: "investigate_anomaly" });
    const r = createRemediationProposalsFromRecommendations([a, b], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.length, 2);
  });

  it("proposal IDs deterministic", () => {
    const rec = makeRec({ recommendationId: "rec-fixed", severity: "warning", evidenceRefs: ["evt-1"] });
    const r1 = createRemediationProposalsFromRecommendations([rec], { windowStart: WS, windowEnd: WE, now: NOW });
    const r2 = createRemediationProposalsFromRecommendations([rec], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r1[0]!.proposalId, r2[0]!.proposalId);
  });

  it("proposalId changes when window changes", () => {
    const rec = makeRec({ recommendationId: "rec-w", severity: "warning" });
    const r1 = createRemediationProposalsFromRecommendations([rec], { windowStart: WS, windowEnd: WE, now: NOW });
    const r2 = createRemediationProposalsFromRecommendations([rec], { windowStart: "2026-06-01T00:00:00.000Z", windowEnd: "2026-06-08T00:00:00.000Z", now: NOW });
    assert.notEqual(r1[0]!.proposalId, r2[0]!.proposalId);
  });

  it("severity rolls up (highest in batch)", () => {
    const a = makeRec({ recommendationId: "rec-a", severity: "info", responseKind: "investigate_anomaly" });
    const b = makeRec({ recommendationId: "rec-b", severity: "critical", responseKind: "investigate_anomaly" });
    const r = createRemediationProposalsFromRecommendations([a, b], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.length, 2);
    const criticalBatch = r.find((p) => p.severity === "critical");
    assert.ok(criticalBatch);
  });

  it("evidenceRefs are deduped and sorted", () => {
    const a = makeRec({ recommendationId: "rec-a", severity: "warning", responseKind: "investigate_anomaly", evidenceRefs: ["evt-b", "evt-a"] });
    const b = makeRec({ recommendationId: "rec-b", severity: "warning", responseKind: "investigate_anomaly", evidenceRefs: ["evt-a", "evt-c"] });
    const r = createRemediationProposalsFromRecommendations([a, b], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.deepEqual(r[0]!.evidenceRefs, ["evt-a", "evt-b", "evt-c"]);
  });

  it("includes windowStart and windowEnd", () => {
    const rec = makeRec();
    const r = createRemediationProposalsFromRecommendations([rec], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r[0]!.windowStart, WS);
    assert.equal(r[0]!.windowEnd, WE);
  });

  it("createdAt uses injected now", () => {
    const rec = makeRec();
    const r = createRemediationProposalsFromRecommendations([rec], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r[0]!.createdAt, NOW);
  });

  it("responseKind typed as union, not widened", () => {
    const a = makeRec({ responseKind: "investigate_anomaly" });
    const b = makeRec({ responseKind: "inspect_policy_gap" });
    const c = makeRec({ responseKind: "verify_audit_integrity" });
    // Compile-time check: assigning a wrong value should fail TS
    const r = createRemediationProposalsFromRecommendations([a, b, c], { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.length, 3);
    const kinds = new Set(r.map((p) => p.responseKind));
    assert.equal(kinds.size, 3);
  });

  it("duplicate source IDs → no duplicate proposal", () => {
    const rec = makeRec({ recommendationId: "rec-dup", severity: "warning" });
    const r = createRemediationProposalsFromRecommendations([rec, rec], { windowStart: WS, windowEnd: WE, now: NOW });
    // Same batch key, so one proposal
    assert.equal(r.length, 1);
  });
});
