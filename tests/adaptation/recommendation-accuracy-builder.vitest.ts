/**
 * P7b — RecommendationAccuracyBuilder tests.
 *
 * Covers: empty input, all-success, all-failure, all-unknown, mixed outcomes,
 * deterministic behavior, custom options, and edge cases.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { RecommendationAccuracyBuilder } from "../../src/adaptation/recommendation-accuracy-builder.js";
import type { OutcomeRecord } from "../../src/adaptation/outcome-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: `outcome:test:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subjectId: "test-subject",
    subjectType: "proposal",
    subject: "Test outcome",
    outcome: "success",
    confidence: 1,
    reasons: [],
    generatedAt: new Date().toISOString(),
    actionTaken: "tested",
    observationWindowDays: 30,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecommendationAccuracyBuilder", () => {
  const builder = new RecommendationAccuracyBuilder();

  // -----------------------------------------------------------------------
  // Empty input
  // -----------------------------------------------------------------------

  describe("empty input", () => {
    it("returns zero counts and zero rates for empty records", () => {
      const report = builder.build([]);

      expect(report.totalOutcomes).toBe(0);
      expect(report.accuracy.knownOutcomes).toBe(0);
      expect(report.accuracy.successRate).toBe(0);
      expect(report.accuracy.partialSuccessRate).toBe(0);
      expect(report.accuracy.failureRate).toBe(0);
      expect(report.outcomeDistribution.success).toBe(0);
      expect(report.outcomeDistribution.failure).toBe(0);
      expect(report.outcomeDistribution.unknown).toBe(0);
      expect(report.windowDays).toBe(30); // default
    });
  });

  // -----------------------------------------------------------------------
  // All success
  // -----------------------------------------------------------------------

  describe("all success", () => {
    it("returns 100% success rate when all outcomes are success", () => {
      const records = [
        makeRecord({ outcome: "success" }),
        makeRecord({ outcome: "success" }),
        makeRecord({ outcome: "success" }),
      ];

      const report = builder.build(records);

      expect(report.totalOutcomes).toBe(3);
      expect(report.accuracy.knownOutcomes).toBe(3);
      expect(report.accuracy.successRate).toBe(1);
      expect(report.accuracy.partialSuccessRate).toBe(0);
      expect(report.accuracy.failureRate).toBe(0);
      expect(report.outcomeDistribution.success).toBe(3);
      expect(report.outcomeDistribution.failure).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // All failure
  // -----------------------------------------------------------------------

  describe("all failure", () => {
    it("returns 0% success rate and 100% failure rate", () => {
      const records = [
        makeRecord({ outcome: "failure" }),
        makeRecord({ outcome: "failure" }),
      ];

      const report = builder.build(records);

      expect(report.totalOutcomes).toBe(2);
      expect(report.accuracy.knownOutcomes).toBe(2);
      expect(report.accuracy.successRate).toBe(0);
      expect(report.accuracy.partialSuccessRate).toBe(0);
      expect(report.accuracy.failureRate).toBe(1);
      expect(report.outcomeDistribution.failure).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // All unknown
  // -----------------------------------------------------------------------

  describe("all unknown", () => {
    it("returns zero known outcomes and zero rates", () => {
      const records = [
        makeRecord({ outcome: "unknown" }),
        makeRecord({ outcome: "unknown" }),
        makeRecord({ outcome: "unknown" }),
      ];

      const report = builder.build(records);

      expect(report.totalOutcomes).toBe(3);
      expect(report.accuracy.knownOutcomes).toBe(0);
      expect(report.accuracy.successRate).toBe(0);
      expect(report.accuracy.partialSuccessRate).toBe(0);
      expect(report.accuracy.failureRate).toBe(0);
      expect(report.outcomeDistribution.unknown).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Mixed outcomes
  // -----------------------------------------------------------------------

  describe("mixed outcomes", () => {
    it("computes correct rates with mixed outcome values", () => {
      const records = [
        makeRecord({ outcome: "success" }),
        makeRecord({ outcome: "success" }),
        makeRecord({ outcome: "success" }),
        makeRecord({ outcome: "partial_success" }),
        makeRecord({ outcome: "neutral" }),
        makeRecord({ outcome: "failure" }),
        makeRecord({ outcome: "failure" }),
        makeRecord({ outcome: "unknown" }),
      ];
      // totals: 3 success, 1 partial_success, 1 neutral, 2 failure, 1 unknown
      // knownOutcomes = 8 - 1 = 7

      const report = builder.build(records);

      expect(report.totalOutcomes).toBe(8);
      expect(report.accuracy.knownOutcomes).toBe(7);
      expect(report.accuracy.successRate).toBeCloseTo(3 / 7, 10);
      expect(report.accuracy.partialSuccessRate).toBeCloseTo(1 / 7, 10);
      expect(report.accuracy.failureRate).toBeCloseTo(2 / 7, 10);

      // Distribution counts
      expect(report.outcomeDistribution.success).toBe(3);
      expect(report.outcomeDistribution.partial_success).toBe(1);
      expect(report.outcomeDistribution.neutral).toBe(1);
      expect(report.outcomeDistribution.failure).toBe(2);
      expect(report.outcomeDistribution.unknown).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Partial success rate
  // -----------------------------------------------------------------------

  describe("partial success", () => {
    it("computes partial success rate independently", () => {
      const records = [
        makeRecord({ outcome: "partial_success" }),
        makeRecord({ outcome: "partial_success" }),
        makeRecord({ outcome: "success" }),
      ];
      // knownOutcomes = 3, partialSuccessRate = 2/3

      const report = builder.build(records);

      expect(report.accuracy.partialSuccessRate).toBeCloseTo(2 / 3, 10);
      expect(report.accuracy.successRate).toBeCloseTo(1 / 3, 10);
    });
  });

  // -----------------------------------------------------------------------
  // Neutral outcomes included in knownOutcomes but not in rates
  // -----------------------------------------------------------------------

  describe("neutral outcomes", () => {
    it("includes neutral in knownOutcomes but not in success/failure rates", () => {
      const records = [
        makeRecord({ outcome: "neutral" }),
        makeRecord({ outcome: "neutral" }),
        makeRecord({ outcome: "success" }),
      ];
      // knownOutcomes = 3, successRate = 1/3

      const report = builder.build(records);

      expect(report.accuracy.knownOutcomes).toBe(3);
      expect(report.accuracy.successRate).toBeCloseTo(1 / 3, 10);
      expect(report.accuracy.failureRate).toBe(0);
      expect(report.outcomeDistribution.neutral).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Custom windowDays
  // -----------------------------------------------------------------------

  describe("custom windowDays", () => {
    it("uses provided windowDays in the report", () => {
      const report = builder.build([], { windowDays: 90 });
      expect(report.windowDays).toBe(90);
    });

    it("defaults to 30 when windowDays is omitted", () => {
      const report = builder.build([]);
      expect(report.windowDays).toBe(30);
    });
  });

  // -----------------------------------------------------------------------
  // Custom generatedAt
  // -----------------------------------------------------------------------

  describe("custom generatedAt", () => {
    it("uses provided generatedAt timestamp", () => {
      const ts = "2025-06-21T00:00:00.000Z";
      const report = builder.build([], { generatedAt: ts });
      expect(report.generatedAt).toBe(ts);
    });

    it("defaults to current ISO timestamp when omitted", () => {
      const before = new Date().toISOString();
      const report = builder.build([]);
      const after = new Date().toISOString();
      expect(report.generatedAt >= before).toBe(true);
      expect(report.generatedAt <= after).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------

  describe("determinism", () => {
    it("produces identical output for identical inputs", () => {
      const records = [
        makeRecord({ outcome: "success" }),
        makeRecord({ outcome: "failure" }),
        makeRecord({ outcome: "unknown" }),
      ];

      const report1 = builder.build(records, {
        windowDays: 30,
        generatedAt: "2025-01-01T00:00:00.000Z",
      });
      const report2 = builder.build(
        // Deep-clone via JSON to rule out reference-sharing bugs
        JSON.parse(JSON.stringify(records)),
        {
          windowDays: 30,
          generatedAt: "2025-01-01T00:00:00.000Z",
        },
      );

      expect(report1).toEqual(report2);
    });
  });

  // -----------------------------------------------------------------------
  // Large input
  // -----------------------------------------------------------------------

  describe("large input", () => {
    it("handles large record sets correctly", () => {
      const records: OutcomeRecord[] = [];
      // 500 success, 200 partial_success, 100 neutral, 150 failure, 50 unknown
      for (let i = 0; i < 500; i++) records.push(makeRecord({ outcome: "success" }));
      for (let i = 0; i < 200; i++) records.push(makeRecord({ outcome: "partial_success" }));
      for (let i = 0; i < 100; i++) records.push(makeRecord({ outcome: "neutral" }));
      for (let i = 0; i < 150; i++) records.push(makeRecord({ outcome: "failure" }));
      for (let i = 0; i < 50; i++) records.push(makeRecord({ outcome: "unknown" }));

      const report = builder.build(records);

      expect(report.totalOutcomes).toBe(1000);
      expect(report.accuracy.knownOutcomes).toBe(950); // 1000 - 50 unknown
      expect(report.accuracy.successRate).toBeCloseTo(500 / 950, 10);
      expect(report.accuracy.partialSuccessRate).toBeCloseTo(200 / 950, 10);
      expect(report.accuracy.failureRate).toBeCloseTo(150 / 950, 10);
      expect(report.outcomeDistribution.success).toBe(500);
      expect(report.outcomeDistribution.partial_success).toBe(200);
      expect(report.outcomeDistribution.neutral).toBe(100);
      expect(report.outcomeDistribution.failure).toBe(150);
      expect(report.outcomeDistribution.unknown).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // Single record
  // -----------------------------------------------------------------------

  describe("single record", () => {
    it("handles a single success record", () => {
      const report = builder.build([makeRecord({ outcome: "success" })]);
      expect(report.totalOutcomes).toBe(1);
      expect(report.accuracy.knownOutcomes).toBe(1);
      expect(report.accuracy.successRate).toBe(1);
    });

    it("handles a single unknown record", () => {
      const report = builder.build([makeRecord({ outcome: "unknown" })]);
      expect(report.totalOutcomes).toBe(1);
      expect(report.accuracy.knownOutcomes).toBe(0);
      expect(report.accuracy.successRate).toBe(0);
    });
  });
});
