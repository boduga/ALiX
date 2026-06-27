import { describe, it, expect } from "vitest";
import {
  classifyRecommendation,
  computeRecommendationEffectiveness,
  EFFECTIVENESS_OK,
  EFFECTIVENESS_NO_DATA,
} from "../../src/executive/recommendation-effectiveness.js";
import type { ClassifyInput, RecommendationEntry } from "../../src/executive/recommendation-effectiveness.js";

const GENERATED_AT = "2026-06-26T00:00:00.000Z";
// Helper: make a basic classify input
function cInput(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    subsystem: "workflow",
    signal: "degrading_trend",
    severity: "high",
    signalConfidence: 0.88,
    recommendation: "Investigate workflow regressions",
    ageDays: 1,
    ...over,
  };
}

describe("classifyRecommendation — unbridged (no proposalId)", () => {
  it("returns unreviewed when age < threshold", () => {
    // age 1 < threshold 7
    expect(classifyRecommendation(cInput({ ageDays: 1 }))).toBe("unreviewed");
  });

  it("returns stale when age >= threshold", () => {
    // age 7 >= threshold 7 → stale (boundary)
    expect(classifyRecommendation(cInput({ ageDays: 7 }))).toBe("stale");
    expect(classifyRecommendation(cInput({ ageDays: 14 }))).toBe("stale");
  });

  it("respects custom threshold", () => {
    expect(classifyRecommendation(cInput({ ageDays: 3 }), 3)).toBe("stale");
    expect(classifyRecommendation(cInput({ ageDays: 2 }), 3)).toBe("unreviewed");
  });
});

describe("classifyRecommendation — bridged (with proposalId)", () => {
  it("returns awaiting_review when proposal is pending", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "pending" }))).toBe("awaiting_review");
  });

  it("returns approved_pending_apply when proposal is approved", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "approved" }))).toBe("approved_pending_apply");
  });

  it("returns applied when proposal is applied", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "applied" }))).toBe("applied");
  });

  it("returns rejected when proposal is rejected", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "rejected" }))).toBe("rejected");
  });

  it("returns failed when proposal is failed", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: "failed" }))).toBe("failed");
  });

  it("returns proposal_missing when proposalStatus is null (load returned null)", () => {
    expect(classifyRecommendation(cInput({ proposalId: "p1", proposalStatus: null }))).toBe("proposal_missing");
  });

  it("remains unreviewed/stale when proposalId is undefined regardless of proposalStatus", () => {
    // proposalId undefined → unbridged branch; proposalStatus is ignored
    expect(classifyRecommendation(cInput({ proposalId: undefined, proposalStatus: "applied" }))).toBe("unreviewed");
  });
});

describe("computeRecommendationEffectiveness", () => {
  it("returns no_data for empty entries", () => {
    const result = computeRecommendationEffectiveness([], 7, GENERATED_AT);
    expect(result.effectivenessStatus).toBe(EFFECTIVENESS_NO_DATA);
    expect(result.signalCalibration).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it("correctly tallies per-signal dispositions", () => {
    const entries: RecommendationEntry[] = [
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "applied" },
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 1, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "rejected" },
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 2, subsystem: "routing", signal: "persistent_instability", severity: "medium", signalConfidence: 0.55, recommendation: "y", ageDays: 1, disposition: "stale" },
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    expect(result.effectivenessStatus).toBe(EFFECTIVENESS_OK);
    expect(result.totalRecommendations).toBe(3);
    expect(result.signalCalibration).toHaveLength(2);

    const deg = result.signalCalibration.find((s) => s.signal === "degrading_trend")!;
    expect(deg.total).toBe(2);
    expect(deg.applied).toBe(1);
    expect(deg.rejected).toBe(1);
    expect(deg.bridgedCount).toBe(2);  // applied + rejected = 2
    expect(deg.actionRate).toBe(1.0);  // 2/2

    const per = result.signalCalibration.find((s) => s.signal === "persistent_instability")!;
    expect(per.total).toBe(1);
    expect(per.stale).toBe(1);
    expect(per.bridgedCount).toBe(0);
    expect(per.actionRate).toBe(0.0);  // 0/1
  });

  it("includes proposal_missing in bridgedCount", () => {
    const entries: RecommendationEntry[] = [
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "proposal_missing", proposalId: "p1" },
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const deg = result.signalCalibration[0];
    expect(deg.proposalMissing).toBe(1);
    expect(deg.bridgedCount).toBe(1); // proposal_missing counted as bridged
    expect(deg.actionRate).toBe(1.0); // 1/1
  });

  it("populates loadWarnings from proposal_missing entries", () => {
    const entries: RecommendationEntry[] = [
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 2, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "proposal_missing", proposalId: "p1" },
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    expect(result.loadWarnings).toContain(
      'proposal not found: p1 (rec index 2 in report r1)',
    );
  });
});

describe("sortRecommendations", () => {
  it("sorts newest-first by generatedAt, then recIndex asc within same timestamp", () => {
    // Note: computeRecommendationEffectiveness calls sort internally; test via the result
    const entries: RecommendationEntry[] = [
      { reportId: "r2", generatedAt: "2026-06-20T00:00:00.000Z", recIndex: 0, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "applied" },
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 1, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "rejected" },
      { reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0, subsystem: "wf", signal: "degrading_trend", severity: "high", signalConfidence: 0.88, recommendation: "x", ageDays: 1, disposition: "applied" },
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    expect(result.recommendations.map((r) => `${r.generatedAt}:${r.recIndex}`)).toEqual([
      "2026-06-26T00:00:00.000Z:0",
      "2026-06-26T00:00:00.000Z:1",
      "2026-06-20T00:00:00.000Z:0",
    ]);
  });
});

describe("computeRecommendationEffectiveness — determinism", () => {
  it("injected generatedAt stamps the result", () => {
    const result = computeRecommendationEffectiveness([], 7, "2099-09-09T00:00:00.000Z");
    expect(result.generatedAt).toBe("2099-09-09T00:00:00.000Z");
  });
});
