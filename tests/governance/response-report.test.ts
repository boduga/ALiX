import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGovernanceResponseReport } from "../../src/governance/response-report.js";
import type { GovernanceResponseRecommendation } from "../../src/governance/response-recommendations.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";
import type { GovernancePolicyFeedbackCandidate } from "../../src/governance/policy-feedback-candidates.js";

const NOW = "2026-07-07T14:00:00.000Z";
const WS = "2026-06-01T00:00:00.000Z";
const WE = "2026-07-08T00:00:00.000Z";

function empty() {
  return {
    recommendations: [] as GovernanceResponseRecommendation[],
    remediationProposals: [] as GovernanceRemediationProposal[],
    policyCandidates: [] as GovernancePolicyFeedbackCandidate[],
  };
}

function makeRec(overrides: Partial<GovernanceResponseRecommendation> = {}): GovernanceResponseRecommendation {
  return {
    recommendationId: "rec-test", source: "anomaly", sourceIds: [],
    severity: "warning", responseKind: "investigate_anomaly",
    title: "t", reason: "r", evidenceRefs: [],
    confidence: 0.75, proposedAction: "a", reversible: true, createdAt: NOW,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<GovernanceRemediationProposal> = {}): GovernanceRemediationProposal {
  return {
    proposalId: "p-test", sourceRecommendationIds: [],
    title: "t", severity: "warning",
    windowStart: WS, windowEnd: WE, evidenceRefs: [],
    status: "open", createdAt: NOW,
    responseKind: "investigate_anomaly", proposedAction: "a", reversible: true,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<GovernancePolicyFeedbackCandidate> = {}): GovernancePolicyFeedbackCandidate {
  return {
    candidateId: "c-test", source: "anomaly", sourceIds: [],
    policyArea: "governance_volume_policy", severity: "warning",
    title: "t", reason: "r", evidenceRefs: [],
    proposedPolicyDirection: "d", confidence: 0.5, createdAt: NOW, reversible: true,
    ...overrides,
  };
}

describe("buildGovernanceResponseReport", () => {
  it("empty → valid zero-valued report", () => {
    const r = buildGovernanceResponseReport(empty(), { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.summary.totalRecommendations, 0);
    assert.equal(r.summary.totalRemediationProposals, 0);
    assert.equal(r.summary.totalPolicyCandidates, 0);
    assert.equal(r.summary.openRemediationCount, 0);
    assert.equal(r.summary.criticalUnresolvedCount, 0);
    assert.equal(r.summary.staleRemediationCount, 0);
  });

  it("windowStart/windowEnd/generatedAt present", () => {
    const r = buildGovernanceResponseReport(empty(), { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.windowStart, WS);
    assert.equal(r.windowEnd, WE);
    assert.equal(r.generatedAt, NOW);
  });

  it("remediation status counts correct", () => {
    const proposals = [
      makeProposal({ status: "open" }),
      makeProposal({ status: "open" }),
      makeProposal({ status: "accepted" }),
      makeProposal({ status: "dismissed" }),
      makeProposal({ status: "resolved" }),
    ];
    const r = buildGovernanceResponseReport({ ...empty(), remediationProposals: proposals }, { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.summary.totalRemediationProposals, 5);
    assert.equal(r.summary.openRemediationCount, 2);
    assert.equal(r.summary.acceptedRemediationCount, 1);
    assert.equal(r.summary.dismissedRemediationCount, 1);
    assert.equal(r.summary.resolvedRemediationCount, 1);
  });

  it("criticalUnresolvedCount from workbench signal metadata", () => {
    const recs = [
      makeRec({ source: "workbench_signal", metadata: { signalType: "unresolved_critical_proposal" } }),
      makeRec({ source: "workbench_signal", metadata: { signalType: "unresolved_critical_proposal" } }),
      makeRec({ source: "workbench_signal", metadata: { signalType: "stale_open_proposal" } }), // other type
    ];
    const r = buildGovernanceResponseReport({ ...empty(), recommendations: recs }, { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.summary.criticalUnresolvedCount, 2);
  });

  it("staleRemediationCount from workbench signal metadata", () => {
    const recs = [
      makeRec({ source: "workbench_signal", metadata: { signalType: "stale_open_proposal" } }),
      makeRec({ source: "workbench_signal", metadata: { signalType: "stale_open_proposal" } }),
    ];
    const r = buildGovernanceResponseReport({ ...empty(), recommendations: recs }, { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.summary.staleRemediationCount, 2);
  });

  it("totalPolicyCandidates counted", () => {
    const cands = [makeCandidate(), makeCandidate()];
    const r = buildGovernanceResponseReport({ ...empty(), policyCandidates: cands }, { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.summary.totalPolicyCandidates, 2);
  });

  it("recommendationSummary groups by source + responseKind + severity", () => {
    const recs = [
      makeRec({ source: "anomaly", responseKind: "investigate_anomaly", severity: "critical" }),
      makeRec({ source: "anomaly", responseKind: "investigate_anomaly", severity: "critical" }),
      makeRec({ source: "workbench_signal", responseKind: "investigate_anomaly", severity: "warning" }),
    ];
    const r = buildGovernanceResponseReport({ ...empty(), recommendations: recs }, { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.recommendationSummary.length, 2);
    const anomalyCritical = r.recommendationSummary.find((x) => x.source === "anomaly" && x.severity === "critical");
    assert.ok(anomalyCritical);
    assert.equal(anomalyCritical!.count, 2);
  });

  it("policyCandidateSummary groups by policyArea + severity", () => {
    const cands = [
      makeCandidate({ policyArea: "governance_volume_policy", severity: "warning" }),
      makeCandidate({ policyArea: "governance_volume_policy", severity: "warning" }),
      makeCandidate({ policyArea: "terminal_decision_policy", severity: "critical" }),
    ];
    const r = buildGovernanceResponseReport({ ...empty(), policyCandidates: cands }, { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.policyCandidateSummary.length, 2);
    const volWarn = r.policyCandidateSummary.find((x) => x.policyArea === "governance_volume_policy");
    assert.ok(volWarn);
    assert.equal(volWarn!.count, 2);
  });

  it("recommendationSummary sort deterministic: severity desc", () => {
    const recs = [
      makeRec({ source: "anomaly", responseKind: "investigate_anomaly", severity: "info" }),
      makeRec({ source: "anomaly", responseKind: "investigate_anomaly", severity: "critical" }),
      makeRec({ source: "anomaly", responseKind: "investigate_anomaly", severity: "warning" }),
    ];
    const r = buildGovernanceResponseReport({ ...empty(), recommendations: recs }, { windowStart: WS, windowEnd: WE, now: NOW });
    assert.equal(r.recommendationSummary[0]!.severity, "critical");
    assert.equal(r.recommendationSummary[1]!.severity, "warning");
    assert.equal(r.recommendationSummary[2]!.severity, "info");
  });
});
