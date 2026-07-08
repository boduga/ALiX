import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPolicyFeedbackCandidates } from "../../src/governance/policy-feedback-candidates.js";
import type { GovernanceAuditAnomaly } from "../../src/governance/audit-anomalies.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";
import type { GovernanceResponseRecommendation } from "../../src/governance/response-recommendations.js";
import type { GovernanceAuditEvent } from "../../src/governance/audit-types.js";
import type { OperatorReview } from "../../src/governance/operator-review.js";

const NOW = "2026-07-07T14:00:00.000Z";
const WS = "2026-06-01T00:00:00.000Z";
const WE = "2026-07-08T00:00:00.000Z";

function empty() {
  return {
    anomalies: [] as GovernanceAuditAnomaly[],
    remediationProposals: [] as GovernanceRemediationProposal[],
    responseRecommendations: [] as GovernanceResponseRecommendation[],
    auditEvents: [] as GovernanceAuditEvent[],
    reviews: [] as OperatorReview[],
  };
}

function makeAnomaly(overrides: Partial<GovernanceAuditAnomaly> = {}): GovernanceAuditAnomaly {
  return {
    anomalyId: `anom-${Math.random().toString(36).slice(2, 4)}`,
    type: "volume_spike",
    severity: "warning",
    windowStart: "2026-06-15T00:00:00.000Z",
    windowEnd: "2026-06-15T01:00:00.000Z",
    evidenceEventIds: [],
    reason: "test",
    metadata: {},
    ...overrides,
  };
}

function makeProposal(overrides: Partial<GovernanceRemediationProposal> = {}): GovernanceRemediationProposal {
  return {
    proposalId: `prop-${Math.random().toString(36).slice(2, 4)}`,
    sourceRecommendationIds: [],
    title: "test",
    severity: "warning",
    windowStart: WS, windowEnd: WE,
    evidenceRefs: [],
    status: "open",
    createdAt: NOW,
    responseKind: "investigate_anomaly",
    proposedAction: "review",
    reversible: true,
    ...overrides,
  };
}

function makeRec(overrides: Partial<GovernanceResponseRecommendation> = {}): GovernanceResponseRecommendation {
  return {
    recommendationId: `rec-${Math.random().toString(36).slice(2, 4)}`,
    source: "workbench_signal",
    sourceIds: [],
    severity: "critical",
    responseKind: "investigate_anomaly",
    title: "test", reason: "test",
    evidenceRefs: [],
    confidence: 0.9,
    proposedAction: "review",
    reversible: true, createdAt: NOW,
    metadata: {},
    ...overrides,
  };
}

function makeEvent(overrides: Partial<GovernanceAuditEvent> = {}): GovernanceAuditEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 4)}`,
    timestamp: "2026-06-15T00:00:00.000Z",
    eventType: "action_allowed",
    actorType: "system", actorId: "gov",
    subjectType: "signal", subjectId: "s1",
    action: "allow", decision: "allowed",
    policyId: null, policyVersion: null, ruleId: null,
    reason: "test", evidenceRefs: [],
    requestId: null, traceId: "t1", sessionId: null, parentEventId: null,
    riskLevel: "low", requiresHumanReview: false,
    metadata: {}, previousHash: null, eventHash: "h",
    ...overrides,
  };
}

function makeReview(overrides: Partial<OperatorReview> = {}): OperatorReview {
  return {
    reviewId: `rev-${Math.random().toString(36).slice(2, 4)}`,
    signalId: "s1", reviewer: "alice",
    notes: "notes", classification: "valid",
    createdAt: NOW, ...overrides,
  };
}

describe("detectPolicyFeedbackCandidates", () => {
  it("empty → []", () => {
    assert.deepEqual(detectPolicyFeedbackCandidates(empty(), { now: NOW, windowStart: WS, windowEnd: WE }), []);
  });

  it("single anomaly below threshold → no candidate", () => {
    const a = makeAnomaly({ type: "volume_spike" });
    const r = detectPolicyFeedbackCandidates({ ...empty(), anomalies: [a] }, { now: NOW, windowStart: WS, windowEnd: WE, anomalyTypeThreshold: 3 });
    assert.equal(r.length, 0);
  });

  it("repeated anomaly type >= threshold → candidate", () => {
    const a1 = makeAnomaly({ type: "volume_spike" });
    const a2 = makeAnomaly({ type: "volume_spike" });
    const a3 = makeAnomaly({ type: "volume_spike" });
    const r = detectPolicyFeedbackCandidates({ ...empty(), anomalies: [a1, a2, a3] }, { now: NOW, windowStart: WS, windowEnd: WE, anomalyTypeThreshold: 3 });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.policyArea, "governance_volume_policy");
    assert.ok(r[0]!.title.startsWith("Consider reviewing"));
    assert.equal(r[0]!.confidence, 0.5); // 3 / (3*2) = 0.5
  });

  it("repeated dismissed pattern >= threshold → candidate", () => {
    const p1 = makeProposal({ status: "dismissed" });
    const p2 = makeProposal({ status: "dismissed" });
    const r = detectPolicyFeedbackCandidates({ ...empty(), remediationProposals: [p1, p2] }, { now: NOW, windowStart: WS, windowEnd: WE, dismissedPatternThreshold: 2 });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.policyArea, "remediation_feedback_policy");
  });

  it("repeated override >= reversalThreshold → terminal_decision_policy", () => {
    const evts = [
      makeEvent({ traceId: "t1", eventType: "action_denied", timestamp: "2026-06-15T00:00:00.000Z" }),
      makeEvent({ traceId: "t1", eventType: "override_applied", timestamp: "2026-06-15T01:00:00.000Z" }),
      makeEvent({ traceId: "t2", eventType: "action_allowed", timestamp: "2026-06-15T02:00:00.000Z" }),
      makeEvent({ traceId: "t2", eventType: "override_applied", timestamp: "2026-06-15T03:00:00.000Z" }),
    ];
    const r = detectPolicyFeedbackCandidates({ ...empty(), auditEvents: evts }, { now: NOW, windowStart: WS, windowEnd: WE, reversalThreshold: 2 });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.policyArea, "terminal_decision_policy");
  });

  it("unresolved critical signals >= threshold → remediation_sla_policy", () => {
    const recs = [
      makeRec({ metadata: { signalType: "unresolved_critical_proposal" } }),
      makeRec({ metadata: { signalType: "unresolved_critical_proposal" } }),
    ];
    const r = detectPolicyFeedbackCandidates({ ...empty(), responseRecommendations: recs }, { now: NOW, windowStart: WS, windowEnd: WE, unresolvedCriticalThreshold: 2 });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.policyArea, "remediation_sla_policy");
  });

  it("incomplete metadata grouped by missing field, not reviewer", () => {
    const rev1 = makeReview({ notes: null, classification: null, reviewer: "alice" });
    const rev2 = makeReview({ notes: null, classification: null, reviewer: "bob" });
    const rev3 = makeReview({ notes: null, classification: null, reviewer: "carol" });
    const r = detectPolicyFeedbackCandidates({ ...empty(), reviews: [rev1, rev2, rev3] }, { now: NOW, windowStart: WS, windowEnd: WE, incompleteMetadataThreshold: 3 });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.policyArea, "review_metadata_policy");
  });

  it("candidateId deterministic", () => {
    const a = makeAnomaly({ type: "volume_spike" });
    const r1 = detectPolicyFeedbackCandidates({ ...empty(), anomalies: [a, a, a] }, { now: NOW, windowStart: WS, windowEnd: WE, anomalyTypeThreshold: 3 });
    const r2 = detectPolicyFeedbackCandidates({ ...empty(), anomalies: [a, a, a] }, { now: NOW, windowStart: WS, windowEnd: WE, anomalyTypeThreshold: 3 });
    if (r1.length > 0 && r2.length > 0) {
      assert.equal(r1[0]!.candidateId, r2[0]!.candidateId);
    }
  });

  it("confidence capped at 1", () => {
    // 6 observations with threshold 2 → 6/(2*2) = 1.5 → capped to 1
    const p1 = makeProposal({ status: "dismissed" });
    const p2 = makeProposal({ status: "dismissed" });
    const p3 = makeProposal({ status: "dismissed" });
    const p4 = makeProposal({ status: "dismissed" });
    const p5 = makeProposal({ status: "dismissed" });
    const p6 = makeProposal({ status: "dismissed" });
    const r = detectPolicyFeedbackCandidates({ ...empty(), remediationProposals: [p1, p2, p3, p4, p5, p6] }, { now: NOW, windowStart: WS, windowEnd: WE, dismissedPatternThreshold: 2 });
    assert.ok(r.every((c) => c.confidence <= 1));
    assert.equal(r[0]!.confidence, 1);
  });

  it("advisory language only — no punitive terms", () => {
    const a = makeAnomaly({ type: "volume_spike" });
    const r = detectPolicyFeedbackCandidates({ ...empty(), anomalies: [a, a, a] }, { now: NOW, windowStart: WS, windowEnd: WE, anomalyTypeThreshold: 3 });
    for (const c of r) {
      const t = c.title.toLowerCase();
      assert.ok(!t.includes("punish"));
      assert.ok(!t.includes("rank"));
      assert.ok(!t.includes("blacklist"));
      assert.ok(t.startsWith("consider reviewing"));
    }
  });

  it("events outside window ignored", () => {
    const a = makeAnomaly({ type: "volume_spike", windowStart: "2025-01-01T00:00:00.000Z" });
    const r = detectPolicyFeedbackCandidates({ ...empty(), anomalies: [a] }, { now: NOW, windowStart: WS, windowEnd: WE, anomalyTypeThreshold: 1 });
    // Anomaly is outside the window, should be ignored
    assert.equal(r.length, 0);
  });
});
