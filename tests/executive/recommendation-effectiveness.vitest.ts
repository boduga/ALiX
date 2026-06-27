import { describe, it, expect } from "vitest";
import {
  classifyRecommendation,
  computeRecommendationEffectiveness,
  applyEffectivenessData,
  EFFECTIVENESS_OK,
  EFFECTIVENESS_NO_DATA,
} from "../../src/executive/recommendation-effectiveness.js";
import type { ClassifyInput, RecommendationEntry, EffectivenessOutcome } from "../../src/executive/recommendation-effectiveness.js";

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

describe("applyEffectivenessData", () => {
  const baseEntry = (over: Partial<RecommendationEntry> = {}): RecommendationEntry => ({
    reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0,
    subsystem: "wf", signal: "degrading_trend", severity: "high",
    signalConfidence: 0.88, recommendation: "x", ageDays: 1,
    disposition: "applied", proposalId: "p1",
    ...over,
  });

  it("sets effectivenessOutcome for applied entries with matching proposalId", () => {
    const map = new Map<string, EffectivenessOutcome>([["p1", "keep"]]);
    const result = applyEffectivenessData([baseEntry()], map);
    expect(result[0].effectivenessOutcome).toBe("keep");
  });

  it("leaves non-applied entries untouched", () => {
    const entry = baseEntry({ disposition: "stale", proposalId: undefined });
    const map = new Map<string, EffectivenessOutcome>([["p1", "keep"]]);
    const result = applyEffectivenessData([entry], map);
    expect(result[0].effectivenessOutcome).toBeUndefined();
    expect(result[0].disposition).toBe("stale");
  });

  it("uses no_data for applied entry when proposalId not in map", () => {
    const map = new Map<string, EffectivenessOutcome>();
    const result = applyEffectivenessData([baseEntry()], map);
    expect(result[0].effectivenessOutcome).toBe("no_data");
  });

  it("sets effectivenessOutcome to undefined for non-applied entries even with proposalId", () => {
    const entry = baseEntry({ disposition: "rejected", proposalId: "p2" });
    const map = new Map<string, EffectivenessOutcome>([["p2", "revert"]]);
    const result = applyEffectivenessData([entry], map);
    expect(result[0].effectivenessOutcome).toBeUndefined();
  });

  it("returns empty array when given empty input", () => {
    const map = new Map<string, EffectivenessOutcome>();
    const result = applyEffectivenessData([], map);
    expect(result).toEqual([]);
  });

  it("handles multiple entries with mixed outcomes", () => {
    const map = new Map<string, EffectivenessOutcome>([["p1", "keep"], ["p3", "investigate"]]);
    const entries = [
      baseEntry({ recIndex: 0, proposalId: "p1" }),
      baseEntry({ recIndex: 1, proposalId: "p2" }),
      baseEntry({ recIndex: 2, proposalId: "p3" }),
      baseEntry({ recIndex: 3, proposalId: "p4" }),
    ];
    const result = applyEffectivenessData(entries, map);
    expect(result[0].effectivenessOutcome).toBe("keep");
    expect(result[1].effectivenessOutcome).toBe("no_data");
    expect(result[2].effectivenessOutcome).toBe("investigate");
    expect(result[3].effectivenessOutcome).toBe("no_data");
  });
});

describe("computeRecommendationEffectiveness — effectiveness metrics (P10.8b)", () => {
  function entry(over: Partial<RecommendationEntry> = {}): RecommendationEntry {
    return {
      reportId: "r1", generatedAt: "2026-06-26T00:00:00.000Z", recIndex: 0,
      subsystem: "wf", signal: "degrading_trend", severity: "high",
      signalConfidence: 0.88, recommendation: "x", ageDays: 1,
      disposition: "applied", proposalId: "p1",
      ...over,
    };
  }

  it("tallies appliedKeep/Revert/Investigate/NoData per signal", () => {
    const entries: RecommendationEntry[] = [
      entry({ proposalId: "p1", effectivenessOutcome: "keep" }),
      entry({ proposalId: "p2", recIndex: 1, effectivenessOutcome: "revert" }),
      entry({ proposalId: "p3", recIndex: 2, effectivenessOutcome: "keep" }),
      entry({ proposalId: "p4", recIndex: 3, effectivenessOutcome: "no_data" }),
      entry({ proposalId: "p5", recIndex: 4, effectivenessOutcome: "investigate" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.applied).toBe(5);
    expect(cal.appliedKeep).toBe(2);
    expect(cal.appliedRevert).toBe(1);
    expect(cal.appliedInvestigate).toBe(1);
    expect(cal.appliedNoData).toBe(1);
  });

  it("effectivenessRate excludes no_data denominator", () => {
    const entries: RecommendationEntry[] = [
      entry({ effectivenessOutcome: "keep" }),
      entry({ recIndex: 1, effectivenessOutcome: "no_data" }),
      entry({ recIndex: 2, effectivenessOutcome: "revert" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.appliedKeep).toBe(1);
    expect(cal.appliedRevert).toBe(1);
    expect(cal.appliedNoData).toBe(1);
    expect(cal.effectivenessRate).toBe(0.5);
    expect(cal.effectivenessCoverage).toBe(0.67);
  });

  it("no applied entries → zero effectiveness metrics", () => {
    const entries: RecommendationEntry[] = [
      entry({ disposition: "stale" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.applied).toBe(0);
    expect(cal.effectivenessRate).toBe(0);
    expect(cal.effectivenessCoverage).toBe(0);
  });

  it("all applied recs have effectiveness data → coverage 1.00", () => {
    const entries: RecommendationEntry[] = [
      entry({ effectivenessOutcome: "keep" }),
      entry({ recIndex: 1, effectivenessOutcome: "revert" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const cal = result.signalCalibration[0];
    expect(cal.effectivenessCoverage).toBe(1.0);
  });

  it("multi-signal effectiveness metrics", () => {
    const entries: RecommendationEntry[] = [
      entry({ signal: "degrading_trend", effectivenessOutcome: "keep" }),
      entry({ recIndex: 1, signal: "improving_trend", effectivenessOutcome: "keep" }),
      entry({ recIndex: 2, signal: "improving_trend", effectivenessOutcome: "no_data" }),
    ];
    const result = computeRecommendationEffectiveness(entries, 7, GENERATED_AT);
    const deg = result.signalCalibration.find(s => s.signal === "degrading_trend")!;
    expect(deg.appliedKeep).toBe(1);
    expect(deg.appliedNoData).toBe(0);
    expect(deg.effectivenessRate).toBe(1.0);
    expect(deg.effectivenessCoverage).toBe(1.0);

    const imp = result.signalCalibration.find(s => s.signal === "improving_trend")!;
    expect(imp.appliedKeep).toBe(1);
    expect(imp.appliedNoData).toBe(1);
    expect(imp.effectivenessRate).toBe(1.0);
    expect(imp.effectivenessCoverage).toBe(0.5);
  });
});
