/**
 * P28.2 — Governance Explainability Builder tests.
 *
 * Tests that the explanation builder:
 * - produces all expected sections from a full trace
 * - handles partial traces gracefully
 * - includes peer_comparison when peerGroup is provided
 * - omits peer_comparison when peerGroup is absent
 * - synthesizes learning from window analytics
 * - never emits prescriptive or ranking language
 * - produces deterministic output from identical inputs
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { DriftOutcomeTrace, DriftCorrelationAnalytics } from "../../src/governance/learning-synthesis-types.js";
import type { GovernanceExplanation } from "../../src/governance/governance-explainability-types.js";
import {
  buildTraceExplanation,
  buildWindowExplanation,
  createExplanationId,
} from "../../src/governance/governance-explainability-builder.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function fullTrace(overrides: Partial<DriftOutcomeTrace> = {}): DriftOutcomeTrace {
  return {
    outcomeId: "outcome-1",
    candidateId: "candidate-1",
    signalId: "signal-1",
    signalKind: "performance_drop",
    signalSeverity: "high",
    signalDirection: "negative",
    windowStart: "2026-06-01",
    windowEnd: "2026-06-30",
    candidateTitle: "Adjust performance threshold",
    candidateStatus: "accepted",
    candidateCreatedAt: "2026-06-15T08:00:00.000Z",
    candidateClosedAt: "2026-06-20T10:00:00.000Z",
    outcomeType: "approved",
    outcomeRecordedAt: "2026-06-20T12:00:00.000Z",
    outcomeRationale: "Threshold adjustment aligned with performance goals",
    timeToReviewDays: 2,
    timeToOutcomeDays: 5,
    ...overrides,
  };
}

function partialTrace(): DriftOutcomeTrace {
  return fullTrace({
    outcomeRationale: "",
    signalDirection: "",
    candidateClosedAt: "",
    timeToReviewDays: 0,
    timeToOutcomeDays: 0,
  });
}

function peerTrace(id: string, outcomeType: string): DriftOutcomeTrace {
  return fullTrace({
    outcomeId: `peer-${id}`,
    candidateId: `peer-candidate-${id}`,
    outcomeType,
  });
}

function sampleAnalytics(): DriftCorrelationAnalytics {
  return {
    totalOutcomes: 10,
    outcomeBySignalKind: {
      performance_drop: { approved: 6, dismissed: 2 },
      cost_spike: { approved: 2 },
    },
    outcomeBySeverity: {
      high: { approved: 5, dismissed: 2 },
      medium: { approved: 3 },
    },
    timeStats: { avgTimeToReviewDays: 3.2, avgTimeToOutcomeDays: 6.1 },
    repeatedPatterns: ["performance_drop followed by threshold adjustment"],
    traceCompleteness: 80,
    missingOutcomes: 2,
  };
}

// ---------------------------------------------------------------------------
// Forbidden language constants
// ---------------------------------------------------------------------------

const FORBIDDEN_RANKING_PHRASES = [
  "performed better",
  "worst case",
  "should prioritize",
  "more successful",
];

const FORBIDDEN_PRESCRIPTIVE = [
  "should",
  "must",
  "recommend",
  "prioritize",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P28.2 — Governance Explainability Builder", () => {
  describe("createExplanationId", () => {
    it("produces deterministic SHA-256 hex string", () => {
      const id1 = createExplanationId(["a", "b"]);
      const id2 = createExplanationId(["a", "b"]);

      assert.strictEqual(id1, id2);
      assert.strictEqual(id1.length, 64);
    });

    it("is order-independent over input trace IDs", () => {
      const id1 = createExplanationId(["a", "b"]);
      const id2 = createExplanationId(["b", "a"]);

      assert.strictEqual(id1, id2);
    });
  });

  describe("buildTraceExplanation", () => {
    it("full trace produces all expected sections", () => {
      const trace = fullTrace();
      const result = buildTraceExplanation(trace);

      // Core fields
      assert.strictEqual(result.explanationId.length, 64);
      assert.strictEqual(typeof result.generatedAt, "string");
      assert.strictEqual(result.subject, trace.candidateTitle);
      assert.deepStrictEqual(result.traceIds, [trace.outcomeId]);

      // Expected sections
      const kinds = result.sections.map((s) => s.kind);
      assert.ok(kinds.includes("signal_origin"), "should include signal_origin");
      assert.ok(kinds.includes("candidate_lifecycle"), "should include candidate_lifecycle");
      assert.ok(kinds.includes("outcome_summary"), "should include outcome_summary");
      assert.ok(kinds.includes("learning_synthesis"), "should include learning_synthesis");

      // Peer comparison NOT present without peerGroup
      assert.ok(!kinds.includes("peer_comparison"), "should NOT include peer_comparison");

      // Boundary flags
      assert.strictEqual(result.readOnly, true);
      assert.strictEqual(result.noPolicyMutation, true);
      assert.strictEqual(result.noThresholdChange, true);
      assert.strictEqual(result.noAutoAdoption, true);
      assert.strictEqual(result.noRanking, true);

      // Each section has content
      for (const section of result.sections) {
        assert.ok(section.heading.length > 0, `section ${section.kind} must have heading`);
        assert.ok(section.body.length > 0, `section ${section.kind} must have body`);
        assert.ok(Array.isArray(section.evidenceRefs), `section ${section.kind} must have evidenceRefs`);
      }
    });

    it("partial trace (missing fields) produces valid partial explanation", () => {
      const trace = partialTrace();
      const result = buildTraceExplanation(trace);

      // Should still produce all core sections
      assert.ok(result.sections.length >= 3);

      // Outcome section should exist even without rationale
      const outcomeSection = result.sections.find((s) => s.kind === "outcome_summary");
      assert.ok(outcomeSection, "outcome_summary should be present");
      assert.ok(outcomeSection.body.length > 0);

      // Every section must have valid structure
      for (const section of result.sections) {
        assert.ok(section.heading.length > 0, `Section ${section.kind} should have heading`);
        assert.ok(Array.isArray(section.evidenceRefs));
        if (section.dataPoints) {
          assert.strictEqual(typeof section.dataPoints, "object");
        }
      }
    });

    it("peer group included produces peer_comparison section", () => {
      const trace = fullTrace();
      const peers = [
        peerTrace("1", "approved"),
        peerTrace("2", "dismissed"),
        peerTrace("3", "approved"),
      ];
      const result = buildTraceExplanation(trace, peers);

      const kinds = result.sections.map((s) => s.kind);
      assert.ok(kinds.includes("peer_comparison"), "peer comparison should be present");

      const peerSection = result.sections.find((s) => s.kind === "peer_comparison");
      assert.ok(peerSection);
      assert.ok(peerSection.body.length > 0);
      assert.ok(peerSection.evidenceRefs.includes(trace.outcomeId));
    });

    it("no peer group omits peer_comparison section", () => {
      const trace = fullTrace();
      const result = buildTraceExplanation(trace);

      const kinds = result.sections.map((s) => s.kind);
      assert.ok(!kinds.includes("peer_comparison"), "peer_comparison should be absent");
    });

    it("no prescriptive language in section body", () => {
      const trace = fullTrace();
      const peers = [
        peerTrace("a", "approved"),
        peerTrace("b", "dismissed"),
      ];
      const result = buildTraceExplanation(trace, peers);

      for (const section of result.sections) {
        const body = section.body.toLowerCase();
        for (const word of FORBIDDEN_PRESCRIPTIVE) {
          assert.ok(
            !body.includes(word),
            `Section ${section.kind} body contains prescriptive word "${word}": "${section.body}"`,
          );
        }
      }
    });

    it("deterministic output for identical inputs", () => {
      const trace = fullTrace();
      const peers = [peerTrace("x", "approved")];

      const result1 = buildTraceExplanation(trace, peers);
      const result2 = buildTraceExplanation(trace, peers);

      // explanationId deterministic
      assert.strictEqual(result1.explanationId, result2.explanationId);

      // Sections identical
      assert.strictEqual(result1.sections.length, result2.sections.length);
      for (let i = 0; i < result1.sections.length; i++) {
        assert.strictEqual(result1.sections[i].kind, result2.sections[i].kind);
        assert.strictEqual(result1.sections[i].heading, result2.sections[i].heading);
        assert.strictEqual(result1.sections[i].body, result2.sections[i].body);
        assert.deepStrictEqual(result1.sections[i].dataPoints, result2.sections[i].dataPoints);
        assert.deepStrictEqual(result1.sections[i].evidenceRefs, result2.sections[i].evidenceRefs);
      }

      // traceIds identical
      assert.deepStrictEqual(result1.traceIds, result2.traceIds);
    });

    it("no ranking statements in peer_comparison sections", () => {
      const trace = fullTrace();
      const peers = [
        peerTrace("x", "approved"),
        peerTrace("y", "dismissed"),
        peerTrace("z", "approved"),
      ];
      const result = buildTraceExplanation(trace, peers);

      const peerSection = result.sections.find((s) => s.kind === "peer_comparison");
      assert.ok(peerSection, "peer_comparison section should be present for this test");

      const body = peerSection.body.toLowerCase();
      for (const phrase of FORBIDDEN_RANKING_PHRASES) {
        assert.ok(
          !body.includes(phrase),
          `Peer comparison body contains ranking phrase "${phrase}": "${peerSection.body}"`,
        );
      }
    });
  });

  describe("buildWindowExplanation", () => {
    it("window synthesis produces learning_synthesis section", () => {
      const traces = [
        fullTrace(),
        fullTrace({ outcomeId: "outcome-2", outcomeType: "dismissed" }),
      ];
      const analytics = sampleAnalytics();

      const result = buildWindowExplanation(traces, analytics);

      // Single section
      assert.strictEqual(result.sections.length, 1);
      assert.strictEqual(result.sections[0].kind, "learning_synthesis");
      assert.ok(result.sections[0].body.length > 0);

      // Body references analytics data
      assert.ok(result.sections[0].body.includes("10"));

      // Boundary flags
      assert.strictEqual(result.readOnly, true);
      assert.strictEqual(result.noPolicyMutation, true);
      assert.strictEqual(result.noThresholdChange, true);
      assert.strictEqual(result.noAutoAdoption, true);
      assert.strictEqual(result.noRanking, true);

      // traceIds from all traces
      assert.deepStrictEqual(result.traceIds, ["outcome-1", "outcome-2"]);

      // Deterministic explanationId
      assert.strictEqual(result.explanationId.length, 64);
    });
  });
});
