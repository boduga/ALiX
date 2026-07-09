import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidateReport,
  renderCandidateReportText,
} from "../../src/governance/policy-review-candidate-report.js";
import type { PolicyReviewCandidate } from "../../src/governance/policy-review-candidate-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function candidate(
  overrides: Partial<PolicyReviewCandidate> = {},
): PolicyReviewCandidate {
  return {
    candidateId: "p25-test-id",
    source: {
      phase: "P24",
      signalId: "p24-cs:abc123",
      signalKind: "calibration_skew",
      signalSeverity: "medium",
      signalDirection: "too_loose",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
    },
    title: "Policy Review: calibration skew",
    summary: "Calibration skew detected.",
    status: "proposed",
    createdAt: ISO,
    updatedAt: ISO,
    evidenceRefs: [],
    review: { notes: [], decisionBasis: [] },
    boundaries: {
      readOnlyEvidence: true,
      noPolicyMutation: true,
      noThresholdChange: true,
      noAutoAdoption: true,
      noRanking: true,
      requiresHumanReview: true,
    },
    ...overrides,
  };
}

describe("buildCandidateReport", () => {
  it("empty candidates produce clean report", () => {
    const report = buildCandidateReport([]);
    assert.equal(report.totalCount, 0);
    assert.equal(report.byStatus.proposed, 0);
  });

  it("shows candidate counts by status", () => {
    const candidates = [
      candidate({ candidateId: "c-1", status: "proposed" }),
      candidate({ candidateId: "c-2", status: "under_review" }),
      candidate({ candidateId: "c-3", status: "proposed" }),
    ];
    const report = buildCandidateReport(candidates);
    assert.equal(report.totalCount, 3);
    assert.equal(report.byStatus.proposed, 2);
    assert.equal(report.byStatus.under_review, 1);
  });

  it("JSON output is parseable", () => {
    const report = buildCandidateReport([candidate()]);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    assert.equal(parsed.totalCount, 1);
  });

  it("includes boundary footer", () => {
    const report = buildCandidateReport([]);
    const text = renderCandidateReportText(report);
    assert.ok(text.includes("No policy was changed"));
    assert.ok(text.includes("No threshold was changed"));
    assert.ok(text.includes("No candidate was ranked"));
    assert.ok(text.includes("No candidate was auto-adopted"));
  });
});
