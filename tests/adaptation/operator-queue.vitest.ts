/** P6.2 — OperatorQueue comprehensive unit tests */

import { describe, it, expect } from "vitest";
import { OperatorQueue } from "../../src/adaptation/operator-queue.js";
import type { QueueInput } from "../../src/adaptation/operator-queue-types.js";
import type { DecisionContext } from "../../src/adaptation/decision-types.js";
import type { RiskScore } from "../../src/adaptation/risk-score-types.js";
import type { ApprovalRecommendation } from "../../src/adaptation/recommendation-types.js";
import type { GovernanceReview } from "../../src/adaptation/governance-review-types.js";
import { GOVERNANCE_VERDICT_SEVERITY } from "../../src/adaptation/governance-review-types.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    id: "ctx-test",
    subject: "Test context",
    outcome: "complete_context",
    confidence: 0.8,
    reasons: [],
    generatedAt: new Date().toISOString(),
    contextStatus: "complete_context",
    proposalId: "prop-test-001",
    proposalStatus: "pending",
    proposalAction: "update_agent_card",
    createdAt: new Date().toISOString(),
    ageDays: 5,
    lineageCompleteness: "complete",
    similarProposals: [],
    effectivenessTrend: { actionType: "update_agent_card", keepRate: 0.8, revertRate: 0.1, sampleSize: 10 },
    sourceArtifacts: [{ type: "proposal", id: "prop-test-001" }],
    dataFreshness: { newestArtifactAgeDays: 1, oldestArtifactAgeDays: 5 },
    ...overrides,
  } as DecisionContext;
}

function makeRisk(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    id: "risk-test",
    subject: "Test risk",
    outcome: "scored",
    confidence: 0.8,
    reasons: [],
    generatedAt: new Date().toISOString(),
    overallRisk: 0.5,
    dimensions: { governance: 0.5, operational: 0.5, capability: 0.5, revertability: 0.5, evidence_quality: 0.5 },
    risks: [],
    sourceArtifacts: [{ type: "context", id: "ctx-test" }],
    ...overrides,
  } as RiskScore;
}

function makeRecommendation(overrides: Partial<ApprovalRecommendation> = {}): ApprovalRecommendation {
  return {
    id: "rec-test",
    subject: "Test recommendation",
    outcome: "recommended",
    confidence: 0.8,
    reasons: ["Test reason"],
    generatedAt: new Date().toISOString(),
    recommendation: "investigate",
    proposalId: "prop-test-001",
    sourceArtifacts: [{ type: "context", id: "ctx-test" }],
    ...overrides,
  } as ApprovalRecommendation;
}

function makeReview(overrides: Partial<GovernanceReview> = {}): GovernanceReview {
  return {
    id: "review-test",
    subject: "Test governance review",
    outcome: "reviewed",
    confidence: 0.7,
    reasons: ["Test review reason"],
    generatedAt: new Date().toISOString(),
    recommendationId: "rec-test",
    proposalId: "prop-test-001",
    verdict: "agree",
    concerns: [],
    blindSpots: [],
    historicalAnalogies: [],
    lensScores: [],
    councilVote: { agree: 4, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0 },
    sourceArtifacts: [{ type: "recommendation", id: "rec-test" }],
    ...overrides,
  } as GovernanceReview;
}

function makeInput(overrides: Partial<QueueInput> = {}): QueueInput {
  return {
    ctx: overrides.ctx ?? makeCtx(),
    riskScore: "riskScore" in overrides ? overrides.riskScore : makeRisk(),
    recommendation: "recommendation" in overrides ? overrides.recommendation : makeRecommendation(),
    governanceReview: "governanceReview" in overrides ? overrides.governanceReview : undefined,
  };
}

// ---------------------------------------------------------------------------
// QueueItem type shape
// ---------------------------------------------------------------------------

describe("QueueItem type shape", () => {
  it("has DecisionArtifact fields", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput()]);
    expect(items.length).toBe(1);
    const item = items[0];
    expect(item.id).toBeDefined();
    expect(item.subject).toBeDefined();
    expect(item.outcome).toBe("queued");
    expect(typeof item.confidence).toBe("number");
    expect(Array.isArray(item.reasons)).toBe(true);
    expect(item.generatedAt).toBeDefined();
  });

  it("has proposalId, position, ordering, sourceArtifacts", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput()]);
    const item = items[0];
    expect(item.proposalId).toBeDefined();
    expect(item.position).toBe(1);
    expect(item.ordering).toBeDefined();
    expect(item.ordering.risk).toBeDefined();
    expect(item.ordering.recommendationRank).toBeDefined();
    expect(item.ordering.ageDays).toBeDefined();
    expect(Array.isArray(item.sourceArtifacts)).toBe(true);
    expect(item.sourceArtifacts.length).toBe(3);
  });

  it("confidence is forwarded from recommendation", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ recommendation: makeRecommendation({ confidence: 0.42 }) })]);
    expect(items[0].confidence).toBe(0.42);
  });

  it("confidence is 0 when no recommendation given", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ recommendation: undefined })]);
    expect(items[0].confidence).toBe(0);
  });

  it("has explicit recommendation field (not parsed from reasons)", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ recommendation: makeRecommendation({ recommendation: "investigate" }) })]);
    expect(items[0].recommendation).toBe("investigate");
  });

  it("recommendation is undefined when no recommendation given", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ recommendation: undefined })]);
    expect(items[0].recommendation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sort correctness
// ---------------------------------------------------------------------------

describe("sort — primary: risk descending", () => {
  it("places higher risk first", () => {
    const highRisk = makeInput({ riskScore: makeRisk({ overallRisk: 0.9 }) });
    const lowRisk = makeInput({ riskScore: makeRisk({ overallRisk: 0.1 }), ctx: makeCtx({ proposalId: "prop-low" }) });
    const q = new OperatorQueue();
    const items = q.build([lowRisk, highRisk]);
    expect(items[0].ordering.risk).toBe(0.9);
    expect(items[1].ordering.risk).toBe(0.1);
  });

  it("equal risk keeps next sort level", () => {
    // Tie on risk → secondary sort by recommendation rank kicks in
    const high = makeInput({
      ctx: makeCtx({ proposalId: "prop-investigate" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "investigate" }),
    });
    const low = makeInput({
      ctx: makeCtx({ proposalId: "prop-approve" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "approve" }),
    });
    const q = new OperatorQueue();
    const items = q.build([low, high]);
    // investigate (4) > approve (1)
    expect(items[0].ordering.recommendationRank).toBe(4);
    expect(items[1].ordering.recommendationRank).toBe(1);
  });
});

describe("sort — secondary: recommendation rank descending", () => {
  it("orders investigate > reject > defer > approve", () => {
    const orders: [string, string][] = [
      ["prop-approve", "approve"],
      ["prop-defer", "defer"],
      ["prop-reject", "reject"],
      ["prop-investigate", "investigate"],
    ];
    const inputs = orders.map(([id, rec]) => makeInput({
      ctx: makeCtx({ proposalId: id }),
      recommendation: makeRecommendation({ recommendation: rec as any }),
    }));
    const q = new OperatorQueue();
    const items = q.build(inputs);
    expect(items[0].proposalId).toBe("prop-investigate");
    expect(items[1].proposalId).toBe("prop-reject");
    expect(items[2].proposalId).toBe("prop-defer");
    expect(items[3].proposalId).toBe("prop-approve");
  });
});

describe("sort — tertiary: age descending", () => {
  it("places older proposals first when risk and recommendation tie", () => {
    const older = makeInput({
      ctx: makeCtx({ proposalId: "prop-old", ageDays: 30 }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "defer" }),
    });
    const newer = makeInput({
      ctx: makeCtx({ proposalId: "prop-new", ageDays: 2 }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "defer" }),
    });
    const q = new OperatorQueue();
    const items = q.build([newer, older]);
    expect(items[0].proposalId).toBe("prop-old");
    expect(items[1].proposalId).toBe("prop-new");
  });
});

describe("sort — final tiebreaker: proposalId ascending", () => {
  it("sorts alphabetically when all other keys tie", () => {
    const a = makeInput({ ctx: makeCtx({ proposalId: "prop-a" }) });
    const b = makeInput({ ctx: makeCtx({ proposalId: "prop-b" }) });
    const q = new OperatorQueue();
    const items = q.build([b, a]);
    expect(items[0].proposalId).toBe("prop-a");
    expect(items[1].proposalId).toBe("prop-b");
  });
});

// ---------------------------------------------------------------------------
// Limit
// ---------------------------------------------------------------------------

describe("limit", () => {
  it("returns all items when no limit set", () => {
    const inputs = [1, 2, 3, 4, 5].map((i) =>
      makeInput({ ctx: makeCtx({ proposalId: `prop-${i}`, ageDays: i }) })
    );
    const q = new OperatorQueue();
    const items = q.build(inputs);
    expect(items.length).toBe(5);
  });

  it("returns top N after sorting", () => {
    const inputs = [
      makeInput({ ctx: makeCtx({ proposalId: "prop-low-risk-1" }), riskScore: makeRisk({ overallRisk: 0.1 }) }),
      makeInput({ ctx: makeCtx({ proposalId: "prop-med-risk" }), riskScore: makeRisk({ overallRisk: 0.5 }) }),
      makeInput({ ctx: makeCtx({ proposalId: "prop-high-risk" }), riskScore: makeRisk({ overallRisk: 0.9 }) }),
    ];
    const q = new OperatorQueue();
    const items = q.build(inputs, { limit: 2 });
    expect(items.length).toBe(2);
    expect(items[0].ordering.risk).toBe(0.9);
    expect(items[1].ordering.risk).toBe(0.5);
  });

  it("returns empty for limit 0", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput()], { limit: 0 });
    expect(items.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("empty input returns empty", () => {
    const q = new OperatorQueue();
    const items = q.build([]);
    expect(items).toEqual([]);
  });

  it("missing risk score treated as 0 (lowest priority)", () => {
    const withoutRisk = makeInput({
      ctx: makeCtx({ proposalId: "prop-no-risk" }),
      riskScore: undefined,
    });
    const withRisk = makeInput({ ctx: makeCtx({ proposalId: "prop-with-risk" }) });
    const q = new OperatorQueue();
    const items = q.build([withoutRisk, withRisk]);
    expect(items[0].proposalId).toBe("prop-with-risk");
    expect(items[1].ordering.risk).toBe(0);
  });

  it("missing recommendation treated as rank 0 (below approve)", () => {
    const noRec = makeInput({
      ctx: makeCtx({ proposalId: "prop-no-rec" }),
      recommendation: undefined,
    });
    const approveRec = makeInput({
      ctx: makeCtx({ proposalId: "prop-approve" }),
      recommendation: makeRecommendation({ recommendation: "approve" }),
    });
    const q = new OperatorQueue();
    const items = q.build([noRec, approveRec]);
    // approve (rank 1) should come before missing (rank 0)
    expect(items[0].proposalId).toBe("prop-approve");
    expect(items[1].ordering.recommendationRank).toBe(0);
  });

  it("deterministic: same shuffled inputs produce same output", () => {
    const inputs = [
      makeInput({ ctx: makeCtx({ proposalId: "prop-c" }), riskScore: makeRisk({ overallRisk: 0.3 }) }),
      makeInput({ ctx: makeCtx({ proposalId: "prop-a" }), riskScore: makeRisk({ overallRisk: 0.9 }) }),
      makeInput({ ctx: makeCtx({ proposalId: "prop-b" }), riskScore: makeRisk({ overallRisk: 0.5 }) }),
    ];
    const q = new OperatorQueue();
    const run1 = q.build([...inputs]);
    // Shuffle by reversing
    const run2 = q.build([...inputs].reverse());
    expect(run1.map((i) => i.proposalId)).toEqual(run2.map((i) => i.proposalId));
    expect(run1.map((i) => i.position)).toEqual(run2.map((i) => i.position));
  });

  it("generatedAt option produces deterministic timestamps", () => {
    const frozenTime = "2026-06-21T12:00:00.000Z";
    const q = new OperatorQueue();
    const items = q.build([makeInput(), makeInput({ ctx: makeCtx({ proposalId: "prop-another" }) })], { generatedAt: frozenTime });
    expect(items[0].generatedAt).toBe(frozenTime);
    expect(items[1].generatedAt).toBe(frozenTime);
    // id includes the deterministic timestamp
    expect(items[0].id).toContain(frozenTime);
  });

  it("reasons explain ordering position, not just echo inputs", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput()]);
    const allReasons = items.flatMap((i) => i.reasons);
    // Should describe ordering contribution
    expect(allReasons.some((r) => r.includes("Risk") || r.includes("risk"))).toBe(true);
    expect(allReasons.some((r) => r.includes("Recommendation rank") || r.includes("recommendation"))).toBe(true);
    expect(allReasons.some((r) => r.includes("Older") || r.includes("day"))).toBe(true);
    // Must NOT contain evaluation language
    expect(allReasons.some((r) => r.startsWith("approve because"))).toBe(false);
    expect(allReasons.some((r) => r.startsWith("reject because"))).toBe(false);
  });

  it("positions are 1-indexed and sequential", () => {
    const inputs = [1, 2, 3].map((i) => makeInput({ ctx: makeCtx({ proposalId: `prop-${i}` }) }));
    const q = new OperatorQueue();
    const items = q.build(inputs);
    expect(items[0].position).toBe(1);
    expect(items[1].position).toBe(2);
    expect(items[2].position).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Governance review severity sort
// ---------------------------------------------------------------------------

describe("sort — quaternary: review severity descending", () => {
  it("review severity breaks tie when risk, recommendation, age are equal", () => {
    const challenge = makeInput({
      ctx: makeCtx({ proposalId: "prop-challenge" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "defer" }),
      governanceReview: makeReview({ verdict: "challenge" }),
    });
    const agree = makeInput({
      ctx: makeCtx({ proposalId: "prop-agree" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "defer" }),
      governanceReview: makeReview({ verdict: "agree" }),
    });
    const q = new OperatorQueue();
    const items = q.build([agree, challenge], { generatedAt: "2026-06-21T12:00:00.000Z" });
    // challenge (severity 2) should sort before agree (severity 0)
    expect(items[0].proposalId).toBe("prop-challenge");
    expect(items[1].proposalId).toBe("prop-agree");
  });

  it("no review → severity 0 (no sort impact)", () => {
    const withReview = makeInput({
      ctx: makeCtx({ proposalId: "prop-with-review" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "approve" }),
      governanceReview: makeReview({ verdict: "agree" }),
    });
    const withoutReview = makeInput({
      ctx: makeCtx({ proposalId: "prop-no-review" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "approve" }),
      governanceReview: undefined,
    });
    const q = new OperatorQueue();
    // Both agree and missing default to severity 0, so tiebreak falls to proposalId
    const items = q.build([withReview, withoutReview], { generatedAt: "2026-06-21T12:00:00.000Z" });
    expect(items[0].proposalId).toBe("prop-no-review");
    expect(items[1].proposalId).toBe("prop-with-review");
  });

  it("higher review severity sorts above lower when risk/recommendation/age tie", () => {
    const insufficient = makeInput({
      ctx: makeCtx({ proposalId: "prop-insufficient" }),
      riskScore: makeRisk({ overallRisk: 0.3 }),
      recommendation: makeRecommendation({ recommendation: "approve" }),
      governanceReview: makeReview({ verdict: "insufficient_information" }),
    });
    const agreeWithConcerns = makeInput({
      ctx: makeCtx({ proposalId: "prop-concerns" }),
      riskScore: makeRisk({ overallRisk: 0.3 }),
      recommendation: makeRecommendation({ recommendation: "approve" }),
      governanceReview: makeReview({ verdict: "agree_with_concerns" }),
    });
    const agree = makeInput({
      ctx: makeCtx({ proposalId: "prop-agree" }),
      riskScore: makeRisk({ overallRisk: 0.3 }),
      recommendation: makeRecommendation({ recommendation: "approve" }),
      governanceReview: makeReview({ verdict: "agree" }),
    });
    const q = new OperatorQueue();
    const items = q.build([agree, insufficient, agreeWithConcerns], { generatedAt: "2026-06-21T12:00:00.000Z" });
    expect(items[0].proposalId).toBe("prop-insufficient"); // severity 3
    expect(items[1].proposalId).toBe("prop-concerns");     // severity 1
    expect(items[2].proposalId).toBe("prop-agree");        // severity 0
  });
});

describe("QueueItem — governanceReview fields", () => {
  it("sets governanceReviewId and governanceVerdict from review", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({
      governanceReview: makeReview({ id: "review-abc", verdict: "challenge" }),
    })]);
    expect(items[0].governanceReviewId).toBe("review-abc");
    expect(items[0].governanceVerdict).toBe("challenge");
  });

  it("governanceReviewId and governanceVerdict are undefined when no review", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ governanceReview: undefined })]);
    expect(items[0].governanceReviewId).toBeUndefined();
    expect(items[0].governanceVerdict).toBeUndefined();
  });

  it("includes review in sourceArtifacts when present", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({
      governanceReview: makeReview({ id: "review-abc" }),
    })]);
    const reviewArtifacts = items[0].sourceArtifacts.filter((a) => a.type === "review");
    expect(reviewArtifacts.length).toBe(1);
    expect(reviewArtifacts[0].id).toBe("review-abc");
  });

  it("does not include review in sourceArtifacts when absent", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ governanceReview: undefined })]);
    const reviewArtifacts = items[0].sourceArtifacts.filter((a) => a.type === "review");
    expect(reviewArtifacts.length).toBe(0);
  });

  it("reasons include review severity when non-zero", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({
      governanceReview: makeReview({ verdict: "challenge" }),
    })]);
    expect(items[0].reasons.some((r) => r.includes("Governance review severity"))).toBe(true);
    expect(items[0].reasons.some((r) => r.includes("2"))).toBe(true);
  });

  it("reasons do NOT include review severity when zero", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({
      governanceReview: makeReview({ verdict: "agree" }),
    })]);
    expect(items[0].reasons.some((r) => r.includes("Governance review severity"))).toBe(false);
  });

  it("evidenceRefs includes governanceReview id when present", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({
      governanceReview: makeReview({ id: "review-evid" }),
    })]);
    expect(items[0].evidenceRefs).toContain("review-evid");
  });
});
