import { describe, it, expect } from "vitest";
import type { OutcomeValue } from "../../src/adaptation/outcome-types.js";
import type { OutcomeRecord } from "../../src/adaptation/outcome-types.js";
import type { OutcomeEvidence } from "../../src/adaptation/outcome-types.js";

describe("OutcomeValue", () => {
  it("accepts success", () => {
    const v: OutcomeValue = "success";
    expect(v).toBe("success");
  });

  it("accepts partial_success", () => {
    const v: OutcomeValue = "partial_success";
    expect(v).toBe("partial_success");
  });

  it("accepts neutral", () => {
    const v: OutcomeValue = "neutral";
    expect(v).toBe("neutral");
  });

  it("accepts failure", () => {
    const v: OutcomeValue = "failure";
    expect(v).toBe("failure");
  });

  it("accepts unknown", () => {
    const v: OutcomeValue = "unknown";
    expect(v).toBe("unknown");
  });
});

describe("OutcomeRecord extends DecisionArtifact", () => {
  it("has id, subject, outcome, confidence, reasons, generatedAt from DecisionArtifact", () => {
    const record: OutcomeRecord = {
      id: "outcome-001",
      subject: "Decision about proposal prop-42",
      outcome: "success",
      confidence: 0.85,
      reasons: ["Goal completion rate increased by 15%"],
      generatedAt: "2026-06-21T00:00:00.000Z",
      subjectId: "prop-42",
      subjectType: "proposal",
      actionTaken: "Applied proposal prop-42 to production",
      observationWindowDays: 7,
    };
    expect(record.id).toBe("outcome-001");
    expect(record.subject).toBe("Decision about proposal prop-42");
    expect(record.outcome).toBe("success");
    expect(record.confidence).toBe(0.85);
    expect(record.reasons).toEqual(["Goal completion rate increased by 15%"]);
    expect(record.generatedAt).toBe("2026-06-21T00:00:00.000Z");
  });

  it("has subjectId, subjectType, actionTaken, outcome, observationWindowDays", () => {
    const record: OutcomeRecord = {
      id: "outcome-002",
      subject: "Capability gap assessment",
      outcome: "failure",
      confidence: 0.6,
      reasons: ["No improvement in capability coverage"],
      generatedAt: "2026-06-20T00:00:00.000Z",
      subjectId: "cap-x",
      subjectType: "capability",
      actionTaken: "Created agent card for cap-x",
      observationWindowDays: 14,
    };
    expect(record.subjectId).toBe("cap-x");
    expect(record.subjectType).toBe("capability");
    expect(record.actionTaken).toBe("Created agent card for cap-x");
    expect(record.outcome).toBe("failure");
    expect(record.observationWindowDays).toBe(14);
  });

  it("governanceReviewId is optional (P6.5b compatibility)", () => {
    const record: OutcomeRecord = {
      id: "outcome-003",
      subject: "Governance-reviewed decision",
      outcome: "partial_success",
      confidence: 0.7,
      reasons: ["Partial improvement observed"],
      generatedAt: "2026-06-19T00:00:00.000Z",
      subjectId: "prop-99",
      subjectType: "proposal",
      actionTaken: "Applied after governance review",
      observationWindowDays: 7,
      // governanceReviewId omitted — optional
    };
    // Type-level check: governanceReviewId should be undefined when not set
    expect(record.governanceReviewId).toBeUndefined();

    // When set, it must be a string
    const recordWithReview: OutcomeRecord = {
      ...record,
      governanceReviewId: "gov-review-abc",
    };
    expect(recordWithReview.governanceReviewId).toBe("gov-review-abc");
  });

  it("inherits optional evidenceRefs from DecisionArtifact", () => {
    const record: OutcomeRecord = {
      id: "outcome-004",
      subject: "Evidence-backed outcome",
      outcome: "success",
      confidence: 0.95,
      reasons: ["Metric delta confirmed"],
      generatedAt: "2026-06-18T00:00:00.000Z",
      subjectId: "prop-7",
      subjectType: "proposal",
      actionTaken: "Applied",
      observationWindowDays: 7,
      evidenceRefs: ["ev-001", "ev-002"],
    };
    expect(record.evidenceRefs).toEqual(["ev-001", "ev-002"]);
  });

  it("accepts all OutcomeValue variants as outcome field", () => {
    const values: OutcomeValue[] = [
      "success",
      "partial_success",
      "neutral",
      "failure",
      "unknown",
    ];
    const records = values.map((v, i) => ({
      id: `outcome-${i}`,
      subject: `Test ${v}`,
      outcome: v,
      confidence: 0.5,
      reasons: [],
      generatedAt: "2026-06-21T00:00:00.000Z",
      subjectId: `sub-${i}`,
      subjectType: "test",
      actionTaken: `Action for ${v}`,
      observationWindowDays: 7,
    })) satisfies OutcomeRecord[];
    expect(records).toHaveLength(5);
    expect(records[0].outcome).toBe("success");
    expect(records[4].outcome).toBe("unknown");
  });
});

describe("OutcomeEvidence", () => {
  it("constructs a valid evidence object", () => {
    const evidence: OutcomeEvidence = {
      id: "ev-001",
      outcomeId: "outcome-001",
      evidenceType: "metric",
      source: "effectiveness_store",
      summary: "Goal completion rate increased by 15% in 7-day window",
      timestamp: "2026-06-21T00:00:00.000Z",
      confidence: 0.9,
    };
    expect(evidence.id).toBe("ev-001");
    expect(evidence.outcomeId).toBe("outcome-001");
    expect(evidence.evidenceType).toBe("metric");
    expect(evidence.source).toBe("effectiveness_store");
    expect(evidence.summary).toContain("15%");
    expect(evidence.confidence).toBe(0.9);
  });
});
