import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectWorkbenchSignals } from "../../src/governance/workbench-signals.js";
import type { GovernanceResponseRecommendation } from "../../src/governance/response-recommendations.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";
import type { OperatorReview } from "../../src/governance/operator-review.js";
import type { OperatorDecision } from "../../src/governance/decision-capture.js";
import type { GovernanceActionProposal } from "../../src/governance/action-queue.js";

const NOW = "2026-07-07T14:00:00.000Z";
const WS = "2026-06-01T00:00:00.000Z";
const WE = "2026-07-08T00:00:00.000Z";
const OLD = "2026-05-01T00:00:00.000Z"; // > 7d from NOW

function empty() {
  return {
    remediationProposals: [] as GovernanceRemediationProposal[],
    responseRecommendations: [] as GovernanceResponseRecommendation[],
    reviews: [] as OperatorReview[],
    decisions: [] as OperatorDecision[],
    actionProposals: [] as GovernanceActionProposal[],
  };
}

function makeProposal(overrides: Partial<GovernanceRemediationProposal> = {}): GovernanceRemediationProposal {
  return {
    proposalId: "prop-test",
    sourceRecommendationIds: ["rec-test"],
    title: "Test proposal",
    severity: "warning",
    windowStart: WS,
    windowEnd: WE,
    evidenceRefs: [],
    status: "open",
    createdAt: NOW,
    responseKind: "investigate_anomaly",
    proposedAction: "Review",
    reversible: true,
    ...overrides,
  };
}

function makeRec(overrides: Partial<GovernanceResponseRecommendation> = {}): GovernanceResponseRecommendation {
  return {
    recommendationId: "rec-test",
    source: "anomaly",
    sourceIds: ["src-1"],
    severity: "warning",
    responseKind: "investigate_anomaly",
    title: "Test",
    reason: "test",
    evidenceRefs: [],
    confidence: 0.75,
    proposedAction: "Review",
    reversible: true,
    createdAt: NOW,
    ...overrides,
  };
}

function makeReview(overrides: Partial<OperatorReview> = {}): OperatorReview {
  return {
    reviewId: "rev-test",
    signalId: "sig-1",
    reviewer: "alice",
    notes: "notes",
    classification: "valid",
    createdAt: NOW,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<OperatorDecision> = {}): OperatorDecision {
  return {
    decisionId: "dec-test",
    signalId: "sig-1",
    decision: "escalate",
    rationale: "needs review",
    decider: "alice",
    reviewId: null,
    actionProposalId: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeActionProposal(overrides: Partial<GovernanceActionProposal> = {}): GovernanceActionProposal {
  return {
    proposalId: "ap-test",
    decisionId: "dec-test",
    signalId: "sig-1",
    kind: "escalation_review",
    title: "Action proposal",
    description: "desc",
    rationale: "reason",
    status: "pending",
    executionRef: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe("detectWorkbenchSignals", () => {
  it("empty inputs → empty output", () => {
    const r = detectWorkbenchSignals(empty(), { now: NOW, windowStart: WS, windowEnd: WE });
    assert.deepEqual(r, []);
  });

  it("open proposal older than staleThresholdDays → stale signal", () => {
    const p = makeProposal({ createdAt: OLD });
    const r = detectWorkbenchSignals({ ...empty(), remediationProposals: [p] }, { now: NOW, staleThresholdDays: 7, windowStart: WS, windowEnd: WE });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.metadata?.signalType, "stale_open_proposal");
  });

  it("open proposal not older than threshold → no stale signal", () => {
    const p = makeProposal({ createdAt: NOW });
    const r = detectWorkbenchSignals({ ...empty(), remediationProposals: [p] }, { now: NOW, staleThresholdDays: 7, windowStart: WS, windowEnd: WE });
    assert.equal(r.filter((x) => x.metadata?.signalType === "stale_open_proposal").length, 0);
  });

  it("critical open proposal older than unresolvedCriticalDays → signal", () => {
    const p = makeProposal({ severity: "critical", createdAt: "2026-07-05T00:00:00.000Z" });
    const r = detectWorkbenchSignals({ ...empty(), remediationProposals: [p] }, { now: NOW, unresolvedCriticalDays: 1, windowStart: WS, windowEnd: WE });
    assert.equal(r.filter((x) => x.metadata?.signalType === "unresolved_critical_proposal").length, 1);
  });

  it("critical open proposal newer → no signal", () => {
    const p = makeProposal({ severity: "critical", createdAt: NOW });
    const r = detectWorkbenchSignals({ ...empty(), remediationProposals: [p] }, { now: NOW, unresolvedCriticalDays: 1, windowStart: WS, windowEnd: WE });
    assert.equal(r.filter((x) => x.metadata?.signalType === "unresolved_critical_proposal").length, 0);
  });

  it("two dismissed proposals same source type → inspect_policy_gap", () => {
    const srcRec = makeRec({ recommendationId: "rec-pattern", responseKind: "inspect_policy_gap", metadata: { signalType: "risk_shift" } });
    const p1 = makeProposal({ proposalId: "prop-dismissed-1", sourceRecommendationIds: ["rec-pattern"], status: "dismissed" });
    const p2 = makeProposal({ proposalId: "prop-dismissed-2", sourceRecommendationIds: ["rec-pattern"], status: "dismissed" });
    const r = detectWorkbenchSignals({ ...empty(), remediationProposals: [p1, p2], responseRecommendations: [srcRec] }, { now: NOW, dismissedPatternThreshold: 2, windowStart: WS, windowEnd: WE });
    assert.equal(r.filter((x) => x.metadata?.signalType === "repeatedly_dismissed_pattern").length, 1);
    assert.equal(r.filter((x) => x.metadata?.signalType === "repeatedly_dismissed_pattern")[0]!.responseKind, "inspect_policy_gap");
  });

  it("one dismissed proposal → no pattern signal", () => {
    const p = makeProposal({ proposalId: "prop-dismissed-1", sourceRecommendationIds: ["rec-test"], status: "dismissed" });
    const r = detectWorkbenchSignals({ ...empty(), remediationProposals: [p], responseRecommendations: [makeRec()] }, { now: NOW, dismissedPatternThreshold: 2, windowStart: WS, windowEnd: WE });
    assert.equal(r.filter((x) => x.metadata?.signalType === "repeatedly_dismissed_pattern").length, 0);
  });

  it("review with null notes → complete_review_metadata signal", () => {
    const rev = makeReview({ notes: null });
    const r = detectWorkbenchSignals({ ...empty(), reviews: [rev] }, { now: NOW, windowStart: WS, windowEnd: WE });
    assert.equal(r.filter((x) => x.metadata?.signalType === "incomplete_review_metadata").length, 1);
  });

  it("review with notes + classification → no signal", () => {
    const rev = makeReview({ notes: "notes", classification: "valid" });
    const r = detectWorkbenchSignals({ ...empty(), reviews: [rev] }, { now: NOW, windowStart: WS, windowEnd: WE });
    assert.equal(r.filter((x) => x.metadata?.signalType === "incomplete_review_metadata").length, 0);
  });

  it("escalate with matching proposal.decisionId → no orphan", () => {
    const d = makeDecision({ decisionId: "dec-match" });
    const ap = makeActionProposal({ decisionId: "dec-match" });
    const r = detectWorkbenchSignals({ ...empty(), decisions: [d], actionProposals: [ap] }, { now: NOW, windowStart: WS, windowEnd: WE });
    assert.equal(r.filter((x) => x.metadata?.signalType === "orphaned_escalation").length, 0);
  });

  it("escalate without matching proposal → orphan signal", () => {
    const d = makeDecision({ decisionId: "dec-orphan" });
    const ap = makeActionProposal({ decisionId: "dec-other" });
    const r = detectWorkbenchSignals({ ...empty(), decisions: [d], actionProposals: [ap] }, { now: NOW, windowStart: WS, windowEnd: WE });
    assert.equal(r.filter((x) => x.metadata?.signalType === "orphaned_escalation").length, 1);
  });

  it("recommendation IDs deterministic", () => {
    const p = makeProposal({ createdAt: OLD });
    const r1 = detectWorkbenchSignals({ ...empty(), remediationProposals: [p] }, { now: NOW, staleThresholdDays: 7, windowStart: WS, windowEnd: WE });
    const r2 = detectWorkbenchSignals({ ...empty(), remediationProposals: [p] }, { now: NOW, staleThresholdDays: 7, windowStart: WS, windowEnd: WE });
    assert.equal(r1[0]!.recommendationId, r2[0]!.recommendationId);
  });

  it("no operator ranking terms in titles", () => {
    const rev = makeReview({ notes: null });
    const r = detectWorkbenchSignals({ ...empty(), reviews: [rev] }, { now: NOW, windowStart: WS, windowEnd: WE });
    for (const rec of r) {
      const title = rec.title.toLowerCase();
      assert.ok(!title.includes("operator failed"));
      assert.ok(!title.includes("reviewer incomplete"));
      assert.ok(!title.includes("low-quality"));
    }
  });
});
