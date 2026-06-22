// tests/learning/learning-types.vitest.ts
import { describe, it, expect } from "vitest";
import type {
  LearningSignal,
  CalibrationProfile,
  LearningProposal,
  LearningReport,
  LearningReportSection,
  LearningPattern,
  LearningSignalType,
  LearningProposalType,
  CalibrationTarget,
} from "../../src/learning/learning-types.js";

// ---------------------------------------------------------------------------
// LearningSignal
// ---------------------------------------------------------------------------

describe("LearningSignal", () => {
  it("accepts a valid overconfidence signal", () => {
    const signal: LearningSignal = {
      id: "ls-1",
      subject: "Recommendation overconfidence in bucket 0.8-1.0",
      outcome: "signal_detected",
      confidence: 0.85,
      reasons: ["Observed success rate 0.55 vs expected 0.90"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      sourceReportId: "acc-1",
      signalType: "overconfidence",
      strength: 0.35,
      summary: "Recommendation confidence 0.90 vs observed 0.55",
      evidenceRefs: ["outcome:2026-06-22-abc123"],
      delta: { expected: 0.9, observed: 0.55, unit: "rate" },
    };
    expect(signal.id).toBe("ls-1");
    expect(signal.signalType).toBe("overconfidence");
    expect(signal.strength).toBe(0.35);
  });

  it("accepts a valid risk_dimension_overfire signal", () => {
    const signal: LearningSignal = {
      id: "ls-2",
      subject: "revert_risk overfire",
      outcome: "signal_detected",
      confidence: 0.7,
      reasons: ["3/3 flagged, 0 actual failures"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      sourceReportId: "risk-cal-1",
      signalType: "risk_dimension_overfire",
      strength: 0.3,
      summary: "revert_risk overfiring — 3 high scores, 0 failures",
      evidenceRefs: [],
    };
    expect(signal.signalType).toBe("risk_dimension_overfire");
    // No delta — optional field
    expect(signal.delta).toBeUndefined();
  });

  it("requires a valid signalType from the union", () => {
    const valid: LearningSignalType = "underconfidence";
    const also: LearningSignalType = "routing_latency_concern";
    expect(typeof valid).toBe("string");
    expect(typeof also).toBe("string");
    // All 14 valid types compile
    const types: LearningSignalType[] = [
      "overconfidence",
      "underconfidence",
      "risk_dimension_overfire",
      "risk_dimension_miss",
      "risk_dimension_ignored",
      "lens_high_predictive_value",
      "lens_low_predictive_value",
      "lens_high_false_positive",
      "lens_high_miss_rate",
      "routing_quality_good",
      "routing_quality_poor",
      "routing_cost_efficient",
      "routing_cost_inefficient",
      "routing_latency_concern",
    ];
    expect(types).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// CalibrationProfile
// ---------------------------------------------------------------------------

describe("CalibrationProfile", () => {
  it("accepts a valid recommendation calibration profile", () => {
    const profile: CalibrationProfile = {
      id: "cp-1",
      subject: "Reduce confidence multiplier for bucket 0.8-1.0",
      outcome: "suggested",
      confidence: 0.85,
      reasons: ["Overconfidence detected: delta -0.35"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      target: "recommendation_confidence_multiplier",
      targetName: "confidence_multiplier_bucket_0.8_1.0",
      previousValue: 1.0,
      suggestedValue: 0.65,
      reason: "Observed overconfidence: expected 0.90, actual 0.55",
      evidenceRefs: ["ls-1"],
      sourceSignalIds: ["ls-1"],
    };
    expect(profile.target).toBe("recommendation_confidence_multiplier");
    expect(profile.previousValue).toBe(1.0);
    expect(profile.suggestedValue).toBe(0.65);
  });

  it("accepts a valid risk weight calibration profile", () => {
    const profile: CalibrationProfile = {
      id: "cp-2",
      subject: "Reduce revert_risk weight",
      outcome: "suggested",
      confidence: 0.7,
      reasons: ["Overfire rate 1.0, 0 failures"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      target: "risk_dimension_weight",
      targetName: "revert_risk",
      previousValue: 0.8,
      suggestedValue: 0.5,
      reason: "revert_risk overfiring — all 3 high-risk proposals were safe",
      evidenceRefs: ["ls-2"],
      sourceSignalIds: ["ls-2"],
    };
    expect(profile.target).toBe("risk_dimension_weight");
  });

  it("requires a valid target from the union", () => {
    const targets: CalibrationTarget[] = [
      "recommendation_confidence_multiplier",
      "risk_dimension_weight",
      "governance_lens_weight",
      "routing_model_preference",
    ];
    expect(targets).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// LearningProposal
// ---------------------------------------------------------------------------

describe("LearningProposal", () => {
  it("accepts a valid learning proposal with requiresApproval: true", () => {
    const proposal: LearningProposal = {
      id: "prop-learning-001",
      subject: "Calibrate recommendation confidence for bucket 0.8-1.0",
      outcome: "pending_learning",
      confidence: 0.85,
      reasons: ["Overconfidence detected, profile prepared"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      proposalType: "recommendation_calibration",
      profiles: [],
      expectedBenefit: "Reduce overconfidence by approximately 18%",
      riskEstimate: "Low — adjustment is within historical variance",
      sourceSignalIds: ["ls-1"],
      requiresApproval: true,
    };
    expect(proposal.proposalType).toBe("recommendation_calibration");
    expect(proposal.requiresApproval).toBe(true);
  });

  it("validates proposalType is from the union", () => {
    const types: LearningProposalType[] = [
      "recommendation_calibration",
      "risk_calibration",
      "governance_calibration",
      "routing_calibration",
    ];
    expect(types).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// LearningReport
// ---------------------------------------------------------------------------

describe("LearningReport", () => {
  it("accepts a valid learning report with all fields", () => {
    const signal: LearningSignal = {
      id: "ls-1",
      subject: "test",
      outcome: "signal_detected",
      confidence: 0.85,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      sourceReportId: "acc-1",
      signalType: "overconfidence",
      strength: 0.35,
      summary: "test",
      evidenceRefs: [],
    };

    const section: LearningReportSection = {
      title: "Recommendation Calibration",
      summary: "Overconfident by 18% in bucket 0.8-1.0",
      signals: [signal],
      profiles: [],
      recommendation: "Reduce confidence multiplier from 1.0 to 0.65",
    };

    const pattern: LearningPattern = {
      description: "Consistent overconfidence across all buckets",
      affectedSignals: ["ls-1"],
      recurrenceCount: 3,
      severity: "significant",
    };

    const report: LearningReport = {
      id: "lr-1",
      subject: "Learning Report — 30 days",
      outcome: "report_generated",
      confidence: 0.9,
      reasons: ["3 signals, 1 profile, 1 pattern"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      windowDays: 30,
      windowStart: "2026-05-23T00:00:00.000Z",
      windowEnd: "2026-06-22T00:00:00.000Z",
      signals: [signal],
      profiles: [],
      sections: [section],
      patterns: [pattern],
    };

    expect(report.windowDays).toBe(30);
    expect(report.sections).toHaveLength(1);
    expect(report.patterns).toHaveLength(1);
    expect(report.patterns![0].severity).toBe("significant");
  });

  it("allows optional patterns to be omitted", () => {
    const report: LearningReport = {
      id: "lr-2",
      subject: "Empty report",
      outcome: "report_generated",
      confidence: 1.0,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      windowDays: 7,
      windowStart: "2026-06-15T00:00:00.000Z",
      windowEnd: "2026-06-22T00:00:00.000Z",
      signals: [],
      profiles: [],
      sections: [],
    };
    expect(report.patterns).toBeUndefined();
  });
});
