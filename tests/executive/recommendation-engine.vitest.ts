import { describe, it, expect } from "vitest";
import {
  computeRecommendations,
  RECOMMENDATION_OK,
  RECOMMENDATION_INSUFFICIENT_DATA,
} from "../../src/executive/recommendation-engine.js";
import type { TrendResult } from "../../src/executive/learning-engine.js";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

/** Build a TrendResult with arbitrary subsystem trends (defaults to a clean ok result). */
function makeTrends(over: Partial<TrendResult> = {}): TrendResult {
  return {
    trendStatus: "ok",
    generatedAt: GENERATED_AT,
    requestedWindow: 10,
    inputReportCount: 8,
    analyzedReportCount: 8,
    skippedReportCount: 0,
    totalImproved: 0,
    totalMixed: 0,
    totalDegraded: 8,
    totalUnchanged: 0,
    subsystemTrends: [],
    objectiveTrends: [],
    warnings: [],
    loadWarnings: [],
    ...over,
  };
}

describe("computeRecommendations — signal detection", () => {
  it("classifies a degrading subsystem as degrading_trend high severity", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "workflow",
        occurrenceCount: 8,
        successRate: 0,
        mixedRate: 0,
        degradationRate: 0.5,
        unchangedRate: 0,
        averageDelta: -3.2,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.recommendationStatus).toBe(RECOMMENDATION_OK);
    expect(result.subsystemRecommendations).toHaveLength(1);
    expect(result.subsystemRecommendations[0]).toEqual({
      subsystem: "workflow",
      signal: "degrading_trend",
      severity: "high",
      recommendation: "Investigate workflow regressions",
      // min(0.95, 3.2*0.15 + 0.5*0.4 + min(0.8,0.2)) = min(0.95, 0.48+0.2+0.2) = 0.88
      confidence: 0.88,
      occurrenceCount: 8,
      averageDelta: -3.2,
    });
  });

  it("classifies degrading_trend as medium severity when avgDelta >= -3", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "routing",
        occurrenceCount: 5,
        successRate: 0,
        mixedRate: 0,
        degradationRate: 0.4,
        unchangedRate: 0,
        averageDelta: -2.0,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("degrading_trend");
    expect(rec.severity).toBe("medium");
    expect(rec.recommendation).toBe("Monitor routing for continued degradation");
    // min(0.95, 2.0*0.15 + 0.4*0.4 + min(0.5,0.2)) = min(0.95, 0.3+0.16+0.2) = 0.66
    expect(rec.confidence).toBe(0.66);
  });

  it("classifies an improving subsystem as improving_trend info severity", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "memory_cache",
        occurrenceCount: 4,
        successRate: 0.6,
        mixedRate: 0,
        degradationRate: 0,
        unchangedRate: 0.4,
        averageDelta: 2.5,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("improving_trend");
    expect(rec.severity).toBe("info");
    expect(rec.recommendation).toBe("Continue current memory_cache optimizations");
    // min(0.95, 2.5*0.1 + 0.6*0.4 + min(0.4,0.2)) = min(0.95, 0.25+0.24+0.2) = 0.69
    expect(rec.confidence).toBe(0.69);
  });

  it("classifies a mixed-dominant subsystem as persistent_instability", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "routing",
        occurrenceCount: 5,
        successRate: 0.2,
        mixedRate: 0.5,
        degradationRate: 0.1,
        unchangedRate: 0.2,
        averageDelta: -0.8,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("persistent_instability");
    expect(rec.severity).toBe("medium");
    expect(rec.recommendation).toBe("Review routing for stability improvements");
    // min(0.9, 0.5*0.5 + min(0.5,0.3)) = min(0.9, 0.25+0.3) = 0.55
    expect(rec.confidence).toBe(0.55);
  });

  it("classifies a low-occurrence subsystem as low_confidence", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "anomaly_detector",
        occurrenceCount: 1,
        successRate: 0,
        mixedRate: 0,
        degradationRate: 1,
        unchangedRate: 0,
        averageDelta: -1.0,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("low_confidence");
    expect(rec.severity).toBe("low");
    expect(rec.recommendation).toBe("Collect more data on anomaly_detector before acting");
    // min(0.3, 1*0.1) = 0.1
    expect(rec.confidence).toBe(0.1);
  });
});

describe("computeRecommendations — precedence", () => {
  it("low_confidence wins over degrading_trend when occurrenceCount <= 2", () => {
    // occurrenceCount 2, but avgDelta -5 and degradationRate 0.9 would otherwise be degrading high.
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "workflow",
        occurrenceCount: 2,
        successRate: 0,
        mixedRate: 0,
        degradationRate: 0.9,
        unchangedRate: 0,
        averageDelta: -5,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("low_confidence");
    expect(rec.severity).toBe("low");
    // min(0.3, 2*0.1) = 0.2
    expect(rec.confidence).toBe(0.2);
  });
});

describe("computeRecommendations — status & empties", () => {
  it("passes through insufficient_data from trends with empty recommendations", () => {
    const trends = makeTrends({ trendStatus: "insufficient_data", analyzedReportCount: 0 });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.recommendationStatus).toBe(RECOMMENDATION_INSUFFICIENT_DATA);
    expect(result.subsystemRecommendations).toEqual([]);
  });

  it("returns ok with empty recommendations when no subsystem crosses a threshold", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "stable_thing",
        occurrenceCount: 5,
        successRate: 0.2,
        mixedRate: 0.1,
        degradationRate: 0.1,
        unchangedRate: 0.6,
        averageDelta: 0,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.recommendationStatus).toBe(RECOMMENDATION_OK);
    expect(result.subsystemRecommendations).toEqual([]);
  });

  it("carries loadWarnings through from trends", () => {
    const trends = makeTrends({ loadWarnings: ["could not load outcome-xyz.json"] });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.loadWarnings).toEqual(["could not load outcome-xyz.json"]);
  });
});

describe("computeRecommendations — sorting", () => {
  it("sorts by confidence desc, then |averageDelta| desc, then subsystem asc", () => {
    // Three low_confidence subsystems (all confidence 0.1) to exercise both tiebreaks:
    //   beta:  |delta| 5.0  -> first
    //   alpha: |delta| 2.0
    //   gamma: |delta| 2.0  -> alpha before gamma by subsystem asc
    const trends = makeTrends({
      subsystemTrends: [
        { subsystem: "alpha", occurrenceCount: 1, successRate: 0, mixedRate: 0, degradationRate: 1, unchangedRate: 0, averageDelta: -2 },
        { subsystem: "beta",  occurrenceCount: 1, successRate: 0, mixedRate: 0, degradationRate: 1, unchangedRate: 0, averageDelta: -5 },
        { subsystem: "gamma", occurrenceCount: 1, successRate: 0, mixedRate: 0, degradationRate: 1, unchangedRate: 0, averageDelta: -2 },
      ],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.subsystemRecommendations.map(r => r.subsystem)).toEqual(["beta", "alpha", "gamma"]);
  });

  it("sorts distinct confidences descending", () => {
    const trends = makeTrends({
      subsystemTrends: [
        { subsystem: "c", occurrenceCount: 5, successRate: 0.2, mixedRate: 0.5, degradationRate: 0.1, unchangedRate: 0.2, averageDelta: -0.8 }, // 0.55
        { subsystem: "a", occurrenceCount: 8, successRate: 0, mixedRate: 0, degradationRate: 0.5, unchangedRate: 0, averageDelta: -3.2 },        // 0.88
        { subsystem: "b", occurrenceCount: 4, successRate: 0.6, mixedRate: 0, degradationRate: 0, unchangedRate: 0.4, averageDelta: 2.5 },        // 0.69
      ],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.subsystemRecommendations.map(r => r.confidence)).toEqual([0.88, 0.69, 0.55]);
  });
});

describe("computeRecommendations — determinism", () => {
  it("uses the injected generatedAt", () => {
    const result = computeRecommendations(makeTrends(), undefined, "2026-09-09T01:02:03.000Z");
    expect(result.generatedAt).toBe("2026-09-09T01:02:03.000Z");
  });
});
