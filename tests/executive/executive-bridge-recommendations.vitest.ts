import { describe, it, expect } from "vitest";
import {
  computeExecutiveProposals,
} from "../../src/executive/executive-bridge-recommendations.js";
import type { ExecutiveBridgeResult } from "../../src/executive/executive-bridge-recommendations.js";
import type { RecommendationReport } from "../../src/executive/recommendation-report-store.js";
import type { ExecutiveRecommendation } from "../../src/executive/recommendation-report-store.js";

const FIXED_NOW = "2026-06-26T00:00:00.000Z";

function makeExecRec(over: Partial<ExecutiveRecommendation> = {}): ExecutiveRecommendation {
  return {
    subsystem: "workflow",
    signal: "degrading_trend",
    severity: "high",
    recommendation: "Investigate workflow regressions",
    signalConfidence: 0.88,
    occurrenceCount: 8,
    averageDelta: -3.2,
    ...over,
  };
}

function makeReport(recs: ExecutiveRecommendation[]): RecommendationReport {
  return {
    schemaVersion: "p10.7b.0",
    id: "recommendation-test",
    contentHash: "x",
    report: {
      generatedAt: FIXED_NOW,
      requestedWindow: 10,
      recommendationStatus: "ok",
      inputReportCount: recs.length,
      analyzedReportCount: recs.length,
      skippedReportCount: 0,
      evidenceReportIds: ["outcome-a"],
      recommendations: recs,
      warnings: [],
      loadWarnings: [],
    },
  };
}

describe("computeExecutiveProposals — eligibility", () => {
  it("treats degrading_trend as eligible", () => {
    const report = makeReport([makeExecRec({ signal: "degrading_trend" })]);
    const result: ExecutiveBridgeResult = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(1);
    expect(result.skippedCount).toBe(0);
  });

  it("treats persistent_instability as eligible", () => {
    const report = makeReport([makeExecRec({ signal: "persistent_instability" })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(1);
  });

  it("skips improving_trend (positive advisory, no action)", () => {
    const report = makeReport([makeExecRec({ signal: "improving_trend" })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("skips low_confidence (too sparse to act on)", () => {
    const report = makeReport([makeExecRec({ signal: "low_confidence" })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("skips recs that already have a proposalId (idempotency)", () => {
    const report = makeReport([makeExecRec({ proposalId: "prop-existing" })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("splits mixed eligibility correctly (3 recs: 2 eligible, 1 skipped)", () => {
    const report = makeReport([
      makeExecRec({ signal: "degrading_trend", subsystem: "alpha" }),
      makeExecRec({ signal: "improving_trend", subsystem: "beta" }),
      makeExecRec({ signal: "persistent_instability", subsystem: "gamma" }),
    ]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.map((d) => d.recIndex)).toEqual([0, 2]);
    expect(result.skippedCount).toBe(1);
  });

  it("handles empty report gracefully", () => {
    const report = makeReport([]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts).toHaveLength(0);
    expect(result.skippedCount).toBe(0);
  });
});

describe("computeExecutiveProposals — proposal shape", () => {
  it("uses create_improvement_issue with {kind:'issue', title} target", () => {
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    const draft = result.drafts[0].proposal;
    expect(draft.action).toBe("create_improvement_issue");
    expect(draft.target).toEqual({ kind: "issue", title: "Investigate workflow regressions" });
  });

  it("payload carries the executive context (source + 9 fields)", () => {
    // evidenceReportIds is on RecommendationDraft (ExecutiveRecommendation extends it),
    // so no cast is needed — the field is part of the type.
    const rec = makeExecRec({ evidenceReportIds: ["o1", "o2"] });
    const report = makeReport([rec]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    const p = result.drafts[0].proposal;
    expect(p.payload).toEqual({
      source: "executive_learning",
      subsystem: "workflow",
      signal: "degrading_trend",
      severity: "high",
      signalConfidence: 0.88,
      occurrenceCount: 8,
      averageDelta: -3.2,
      evidenceReportIds: ["outcome-a"],
      recommendationText: "Investigate workflow regressions",
    });
  });

  it("sets sourceRecommendationType='executive_learning' and sourceConfidence=signalConfidence", () => {
    const report = makeReport([makeExecRec({ signalConfidence: 0.42 })]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    const draft = result.drafts[0].proposal;
    expect(draft.sourceRecommendationType).toBe("executive_learning");
    expect(draft.sourceConfidence).toBe(0.42);
  });

  it("carries status='pending' and provenance='manual'", () => {
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    const draft = result.drafts[0].proposal;
    expect(draft.status).toBe("pending");
    expect(draft.provenance).toBe("manual");
  });

  it("evidenceFingerprints = report.evidenceReportIds (spread copy)", () => {
    const report = makeReport([makeExecRec()]);
    report.report.evidenceReportIds = ["e1", "e2", "e3"];
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts[0].proposal.evidenceFingerprints).toEqual(["e1", "e2", "e3"]);
  });

  it("draft proposal has id='' (handler will assign nextProposalId)", () => {
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(result.drafts[0].proposal.id).toBe("");
  });

  it("createdAt equals the injected generatedAt", () => {
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, "2099-01-01T00:00:00.000Z");
    expect(result.drafts[0].proposal.createdAt).toBe("2099-01-01T00:00:00.000Z");
  });
});

describe("computeExecutiveProposals — purity + determinism", () => {
  it("is deterministic: same (report, generatedAt) → same drafts", () => {
    const report = makeReport([
      makeExecRec({ subsystem: "alpha" }),
      makeExecRec({ subsystem: "beta", signal: "improving_trend" }),
    ]);
    const r1 = computeExecutiveProposals(report, FIXED_NOW);
    const r2 = computeExecutiveProposals(report, FIXED_NOW);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("does not reference bridgedUpdates, proposalId assignment, or governanceStatus (separation)", () => {
    // Verify the function signature: the return type has `drafts` and `skippedCount` only.
    const report = makeReport([makeExecRec()]);
    const result = computeExecutiveProposals(report, FIXED_NOW);
    expect(Object.keys(result).sort()).toEqual(["drafts", "skippedCount"]);
  });
});
