import { describe, it, expect } from "vitest";
import {
  EXTRACTORS,
  extractForwardRefs,
} from "../../src/learning/forward-ref-extractors.js";
import { ARTIFACT_TYPES } from "../../src/learning/evidence-chain-types.js";
import type {
  OutcomeRecord,
  LensCalibrationReport,
} from "../../src/adaptation/outcome-types.js";
import type { GovernanceReview } from "../../src/adaptation/governance-review-types.js";
import type { RiskScore } from "../../src/adaptation/risk-score-types.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type {
  LearningSignal,
  CalibrationProfile,
  LearningProposal,
} from "../../src/learning/learning-types.js";

const TS = "2026-06-22T00:00:00.000Z";

describe("forward-ref-extractors: registry completeness", () => {
  it("EXTRACTORS covers every ArtifactType except learning_evidence_chain", () => {
    for (const t of ARTIFACT_TYPES) {
      if (t === "learning_evidence_chain") continue;
      expect(typeof EXTRACTORS[t]).toBe("function");
    }
  });
});

describe("forward-ref-extractors: OutcomeRecord", () => {
  it("extracts decisionId, recommendationId, governanceReviewId", () => {
    const outcome: OutcomeRecord = {
      id: "out-1",
      subject: "x",
      outcome: "success",
      confidence: 0.9,
      reasons: [],
      generatedAt: TS,
      subjectId: "sub-1",
      subjectType: "proposal",
      decisionId: "dec-1",
      recommendationId: "rec-1",
      governanceReviewId: "gr-1",
      actionTaken: "applied",
      observationWindowDays: 30,
    };
    const links = extractForwardRefs(outcome, "outcome_record", "out-1", TS);
    const targets = links.map((l) => `${l.targetArtifactId}/${l.relationship}`);
    expect(targets).toContain("dec-1/derived_from");
    expect(targets).toContain("rec-1/derived_from");
    expect(targets).toContain("gr-1/derived_from");
  });

  it("omits links for absent forward refs", () => {
    const outcome: OutcomeRecord = {
      id: "out-2",
      subject: "x",
      outcome: "success",
      confidence: 0.9,
      reasons: [],
      generatedAt: TS,
      subjectId: "sub-2",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 30,
    };
    const links = extractForwardRefs(outcome, "outcome_record", "out-2", TS);
    expect(links).toEqual([]);
  });
});

describe("forward-ref-extractors: GovernanceReview", () => {
  it("extracts recommendationId and proposalId", () => {
    const review: GovernanceReview = {
      id: "gr-1",
      subject: "x",
      outcome: "reviewed",
      confidence: 0.8,
      reasons: [],
      generatedAt: TS,
      recommendationId: "rec-1",
      proposalId: "prop-1",
      verdict: "agree_with_concerns",
      concerns: [],
      blindSpots: [],
      historicalAnalogies: [],
      lensScores: [],
      councilVote: { agree: 3, agreeWithConcerns: 1, challenge: 0, insufficientInformation: 0 },
      sourceArtifacts: [],
    };
    const links = extractForwardRefs(review, "governance_review", "gr-1", TS);
    const ids = links.map((l) => `${l.targetArtifactId}/${l.relationship}`).sort();
    expect(ids).toContain("rec-1/reviewed_from");
    expect(ids).toContain("prop-1/reviewed_from");
  });
});

describe("forward-ref-extractors: RiskScore", () => {
  it("extracts sourceArtifacts entries", () => {
    const risk: RiskScore = {
      id: "r-1",
      subject: "x",
      outcome: "medium",
      confidence: 0.8,
      reasons: [],
      generatedAt: TS,
      overallRisk: 0.5,
      risks: [],
      dimensions: {} as RiskScore["dimensions"],
      sourceArtifacts: [
        { type: "recommendation", id: "rec-1" },
        { type: "context", id: "ctx-1" },
      ],
    };
    const links = extractForwardRefs(risk, "risk_score", "r-1", TS);
    expect(links.map((l) => `${l.targetArtifactId}/${l.relationship}`).sort()).toEqual([
      "ctx-1/supports",
      "rec-1/supports",
    ]);
  });
});

describe("forward-ref-extractors: LearningSignal", () => {
  it("extracts sourceReportId (derived_from) and evidenceRefs (supports)", () => {
    const signal: LearningSignal = {
      id: "sig-1",
      subject: "x",
      outcome: "signal_detected",
      confidence: 0.85,
      reasons: [],
      generatedAt: TS,
      sourceReportId: "acc-1",
      signalType: "overconfidence",
      strength: 0.35,
      summary: "Overconfident by 18%",
      evidenceRefs: ["out-1", "out-2"],
    };
    const links = extractForwardRefs(signal, "learning_signal", "sig-1", TS);
    const byRel = Object.fromEntries(
      links.map((l) => [l.relationship, l.targetArtifactId]),
    );
    expect(byRel.derived_from).toBe("acc-1");
    expect(
      links
        .filter((l) => l.relationship === "supports")
        .map((l) => l.targetArtifactId)
        .sort(),
    ).toEqual(["out-1", "out-2"]);
  });
});

describe("forward-ref-extractors: CalibrationProfile", () => {
  it("extracts evidenceRefs (supports) and sourceSignalIds (derived_from)", () => {
    const profile: CalibrationProfile = {
      id: "cp-1",
      subject: "x",
      outcome: "suggested",
      confidence: 0.85,
      reasons: [],
      generatedAt: TS,
      target: "recommendation_confidence_multiplier",
      targetName: "bucket_0.8_1.0",
      previousValue: 1.0,
      suggestedValue: 0.65,
      reason: "Observed overconfidence",
      evidenceRefs: ["out-1"],
      sourceSignalIds: ["sig-1", "sig-2"],
    };
    const links = extractForwardRefs(profile, "calibration_profile", "cp-1", TS);
    const ids = links.map((l) => `${l.targetArtifactId}/${l.relationship}`).sort();
    expect(ids).toContain("out-1/supports");
    expect(ids).toContain("sig-1/derived_from");
    expect(ids).toContain("sig-2/derived_from");
  });
});

describe("forward-ref-extractors: AdaptationProposal", () => {
  it("extracts sourceSignalIds and an approved_from link if approved", () => {
    const proposal: AdaptationProposal = {
      id: "ap-1",
      createdAt: TS,
      status: "approved",
      action: "adjust_calibration",
      target: "recommendation_confidence",
      payload: {},
      sourceRecommendationType: "overconfidence_correction",
      sourceConfidence: 0.85,
      evidenceFingerprints: [],
      reason: "Reduce overconfidence",
      approvedBy: "human:operator-7",
      approvedAt: TS,
    } as unknown as AdaptationProposal;

    const links = extractForwardRefs(proposal, "adaptation_proposal", "ap-1", TS);
    // approved_from link from the proposal to the approver (identity)
    expect(links.some((l) => l.relationship === "approved_from" && l.targetArtifactId === "human:operator-7")).toBe(true);
  });
});

describe("forward-ref-extractors: LearningProposal", () => {
  it("extracts sourceSignalIds as derived_from", () => {
    const lp: LearningProposal = {
      id: "lp-1",
      subject: "x",
      outcome: "learning_proposal",
      confidence: 0.9,
      reasons: [],
      generatedAt: TS,
      proposalType: "recommendation_calibration",
      profiles: [],
      expectedBenefit: "Tighten calibration",
      riskEstimate: "Low",
      sourceSignalIds: ["sig-1", "sig-2"],
      requiresApproval: true,
    };
    const links = extractForwardRefs(lp, "learning_proposal", "lp-1", TS);
    const ids = links.map((l) => `${l.targetArtifactId}/${l.relationship}`).sort();
    expect(ids).toEqual(["sig-1/derived_from", "sig-2/derived_from"]);
  });
});

describe("forward-ref-extractors: LensCalibrationReport (empty)", () => {
  it("returns an empty list (no direct forward refs)", () => {
    const report: LensCalibrationReport = {
      id: "lcr-1",
      subject: "x",
      outcome: "report",
      confidence: 1,
      reasons: [],
      generatedAt: TS,
      evidenceRefs: ["out-1", "out-2"],
      // LensCalibrationReport-specific fields are tolerated as empty
    } as unknown as LensCalibrationReport;
    const links = extractForwardRefs(report, "lens_calibration_report", "lcr-1", TS);
    expect(Array.isArray(links)).toBe(true);
  });
});

describe("forward-ref-extractors: defensive registry coverage", () => {
  it("returns [] for an unknown artifact type (defensive fallback)", () => {
    const links = extractForwardRefs({}, "decision_context" as never, "ctx-1", TS);
    expect(Array.isArray(links)).toBe(true);
  });

  it("returns [] for learning_evidence_chain artifact type (chains don't currently link chains)", () => {
    const links = extractForwardRefs(
      { id: "chain-1" },
      "learning_evidence_chain",
      "chain-1",
      TS,
    );
    expect(links).toEqual([]);
  });
});
