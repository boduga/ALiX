/**
 * P23.4 — Replay Report tests.
 *
 * Tests that the report builder:
 * - produces text output with all required fields
 * - produces JSON output with all required fields
 * - includes boundary footer
 * - includes P23-REPLAY-START/END delimiters
 * - handles empty scenarios safely
 * - renders candidate lessons as advisory
 */

import { describe, it, expect } from "vitest";

import { buildReplayReport, formatReplayReport, renderReportText } from "../../src/governance/replay/replay-report.js";
import type { CounterfactualReplayOutcome } from "../../src/governance/replay/types.js";

const VALID_ISO = "2026-07-09T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function outcome(overrides: Partial<CounterfactualReplayOutcome> = {}): CounterfactualReplayOutcome {
  return {
    replayId: "test-replay-1",
    sourceLifecycleId: "lc-1",
    scenarioId: "Strict evidence review",
    originalOutcome: {
      readinessLevel: "dry_run_capable",
      evidenceCompleteness: "full",
      handoffReadiness: "ready",
      closureDecision: "accepted",
      closureRiskLevel: "low",
      qualitySignalCount: 0,
      requiresAttention: false,
    },
    counterfactualOutcome: {
      readinessLevel: "manual_only",
      evidenceCompleteness: "partial",
      handoffReadiness: "partial",
      closureDecision: "accepted",
      closureRiskLevel: "medium",
      qualitySignalCount: 1,
      requiresAttention: true,
      blocked: true,
      blockedReasons: ["Evidence incomplete"],
    },
    diff: {
      category: "readiness_changed",
      details: Object.freeze([
        {
          category: "readiness_changed",
          sourceId: "replay",
          field: "readinessLevel",
          originalValue: "dry_run_capable",
          counterfactualValue: "manual_only",
        },
        {
          category: "evidence_gap_changed",
          sourceId: "replay",
          field: "evidenceCompleteness",
          originalValue: "full",
          counterfactualValue: "partial",
        },
      ]),
    },
    riskDelta: {
      originalRisk: "low",
      counterfactualRisk: "medium",
      direction: "increased",
    },
    candidateLessons: Object.freeze([
      {
        lessonId: "lesson-1",
        summary: "Readiness level downgraded under stricter evidence requirements",
        basis: ["counterfactual_readiness_assumptions"],
        confidence: "medium",
        appliesTo: "readiness",
        requiresHumanReview: true,
      },
    ]),
    generatedAt: VALID_ISO,
    readOnly: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("replay-report", () => {
  it("builds a report with all required fields", () => {
    const report = buildReplayReport(outcome());

    expect(report.replayId).toBe("test-replay-1");
    expect(report.sourceLifecycleId).toBe("lc-1");
    expect(report.scenarioName).toBe("Strict evidence review");
    expect(report.sourceRecords).toBeDefined();
    expect(report.originalOutcome).toBeDefined();
    expect(report.counterfactualOutcome).toBeDefined();
    expect(report.diff).toBeDefined();
    expect(report.riskDelta).toBeDefined();
    expect(report.candidateLessons).toBeDefined();
    expect(report.footer).toBeDefined();
  });

  it("includes boundary footer in text output", () => {
    const output = formatReplayReport(outcome(), "text");

    expect(output).toContain("P23 replay report is read-only");
    expect(output).toContain("No policy, approval, readiness, handoff");
    expect(output).toContain("advisory and require governed human review");
  });

  it("includes P23-REPLAY-START and P23-REPLAY-END delimiters in text output", () => {
    const output = formatReplayReport(outcome(), "text");

    expect(output).toContain("P23-REPLAY-START");
    expect(output).toContain("P23-REPLAY-END");
    // START comes before END
    expect(output.indexOf("P23-REPLAY-START")).toBeLessThan(output.indexOf("P23-REPLAY-END"));
  });

  it("includes replay id, source lifecycle id, and scenario name in text output", () => {
    const output = formatReplayReport(outcome(), "text");

    expect(output).toContain("test-replay-1");
    expect(output).toContain("lc-1");
    expect(output).toContain("Strict evidence review");
  });

  it("includes diff category and details in text output", () => {
    const output = formatReplayReport(outcome(), "text");

    expect(output).toContain("readiness_changed");
    expect(output).toContain("dry_run_capable");
    expect(output).toContain("manual_only");
  });

  it("includes risk delta in text output", () => {
    const output = formatReplayReport(outcome(), "text");

    expect(output).toContain("increased");
    expect(output).toContain("Original risk");
    expect(output).toContain("Counterfactual risk");
  });

  it("includes candidate lessons as advisory in text output", () => {
    const output = formatReplayReport(outcome(), "text");

    expect(output).toContain("Candidate Lessons");
    expect(output).toContain("Readiness level downgraded");
    expect(output).toContain("Requires human review: yes");
  });

  it("produces valid JSON output with all fields", () => {
    const output = formatReplayReport(outcome(), "json");
    const parsed = JSON.parse(output);

    expect(parsed.replayId).toBe("test-replay-1");
    expect(parsed.sourceLifecycleId).toBe("lc-1");
    expect(parsed.scenarioName).toBe("Strict evidence review");
    expect(parsed.footer).toContain("read-only");
    expect(parsed.diff.category).toBe("readiness_changed");
    expect(parsed.riskDelta.direction).toBe("increased");
    expect(parsed.candidateLessons).toHaveLength(1);
  });

  it("handles empty outcome with no candidate lessons", () => {
    const empty = outcome({
      scenarioId: "empty-test",
      diff: { category: "unchanged", details: Object.freeze([]) },
      candidateLessons: Object.freeze([]),
      counterfactualOutcome: {
        readinessLevel: null,
        evidenceCompleteness: "none",
        handoffReadiness: "not_ready",
        closureDecision: null,
        closureRiskLevel: null,
        qualitySignalCount: 0,
        requiresAttention: false,
        blocked: false,
        blockedReasons: [],
      },
    });

    const text = formatReplayReport(empty, "text");
    expect(text).toContain("No candidate lessons generated");
    expect(text).toContain("unchanged");
  });

  it("renders changed readiness signals section when readiness_changed exists", () => {
    const output = formatReplayReport(outcome(), "text");

    expect(output).toContain("Changed Readiness Signals");
  });

  it("renders changed closure risk signals section when closure_risk_changed exists", () => {
    const withRiskChange = outcome({
      diff: {
        category: "closure_risk_changed",
        details: Object.freeze([
          {
            category: "closure_risk_changed",
            sourceId: "replay",
            field: "closureRiskLevel",
            originalValue: "low",
            counterfactualValue: "high",
          },
        ]),
      },
    });
    const output = formatReplayReport(withRiskChange, "text");

    expect(output).toContain("Changed Closure Risk Signals");
    expect(output).toContain("low");
    expect(output).toContain("high");
  });

  it("renders changed handoff quality signals section when handoff_quality_changed exists", () => {
    const withHandoffChange = outcome({
      diff: {
        category: "handoff_quality_changed",
        details: Object.freeze([
          {
            category: "handoff_quality_changed",
            sourceId: "replay",
            field: "handoffReadiness",
            originalValue: "ready",
            counterfactualValue: "not_ready",
          },
        ]),
      },
    });
    const output = formatReplayReport(withHandoffChange, "text");

    expect(output).toContain("Changed Handoff Quality Signals");
  });
});
