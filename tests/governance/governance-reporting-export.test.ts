/**
 * P29.3 — Compliance Package Export tests.
 *
 * 4 tests covering:
 * 1. renderComplianceJson returns parseable JSON
 * 2. renderComplianceJson has trailing newline
 * 3. renderComplianceText includes inventory counts
 * 4. renderComplianceText includes section headers for all sections
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  renderComplianceJson,
  renderComplianceText,
} from "../../src/governance/governance-reporting-export.js";
import type { CompliancePackage } from "../../src/governance/governance-reporting-types.js";

// ---------------------------------------------------------------------------
// Factory — creates a minimal but valid CompliancePackage for testing
// ---------------------------------------------------------------------------

function minimalPackage(
  overrides: Partial<CompliancePackage> = {},
): CompliancePackage {
  return {
    packageId: "pkg-test-001",
    generatedAt: "2026-07-09T12:00:00.000Z",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",

    totalSignals: 2,
    totalCandidates: 1,
    totalOutcomes: 1,
    totalTraces: 1,

    signalSummary: [
      {
        signalId: "sig-1",
        kind: "calibration_skew",
        severity: "medium",
        direction: "too_loose",
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-07-01T00:00:00.000Z",
      },
      {
        signalId: "sig-2",
        kind: "policy_drift",
        severity: "high",
        direction: "tightening",
        windowStart: "2026-06-15T00:00:00.000Z",
        windowEnd: "2026-07-01T00:00:00.000Z",
      },
    ],
    candidateSummary: [
      {
        candidateId: "cand-1",
        title: "Tighten calibration threshold",
        status: "accepted_for_policy_review",
        signalKind: "calibration_skew",
        signalSeverity: "medium",
        createdAt: "2026-06-15T10:00:00.000Z",
        hasOutcome: true,
      },
    ],
    outcomeSummary: [
      {
        outcomeId: "out-1",
        candidateId: "cand-1",
        outcomeType: "accepted_for_policy_work",
        recordedBy: "governance-review",
        rationale: "Evidence supports threshold adjustment.",
      },
    ],
    traceSummary: [
      {
        outcomeId: "out-1",
        candidateId: "cand-1",
        signalKind: "calibration_skew",
        outcomeType: "accepted_for_policy_work",
        timeToOutcomeDays: 10.5,
      },
    ],

    correlationAnalytics: {
      signalToOutcomeCorrelations: [
        {
          signalKind: "calibration_skew",
          outcomeType: "accepted_for_policy_work",
          correlationStrength: 0.85,
          sampleSize: 12,
        },
      ],
      evidenceCoverage: { totalSignals: 10, withOutcome: 7, coverageRate: 0.7 },
      commonPatterns: ["calibration_skew → accepted_for_policy_work"],
    },

    keyExplanations: [
      {
        explanationId: "expl-1",
        type: "correlation",
        description: "Strong correlation between calibration_skew and accepted outcomes.",
        relatedIds: ["sig-1", "cand-1", "out-1"],
        confidence: 0.85,
      },
    ],

    phasesIncluded: ["P24", "P25", "P26", "P27", "P28"],

    readOnly: true,
    noPolicyMutation: true,
    noThresholdChange: true,
    noAutoAdoption: true,
    noRanking: true,

    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderComplianceJson (P29.3)", () => {
  it("returns parseable JSON with all top-level keys", () => {
    const pkg = minimalPackage();
    const output = renderComplianceJson(pkg);
    let parsed: Record<string, unknown>;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(output);
    });
    // Verify key fields survive round-trip
    assert.equal(parsed!.packageId, "pkg-test-001");
    assert.equal(parsed!.totalSignals, 2);
    assert.equal(parsed!.totalCandidates, 1);
    assert.equal(parsed!.totalOutcomes, 1);
    assert.equal(parsed!.totalTraces, 1);
    assert.ok(Array.isArray(parsed!.signalSummary));
    assert.ok(Array.isArray(parsed!.candidateSummary));
    assert.ok(Array.isArray(parsed!.outcomeSummary));
    assert.ok(Array.isArray(parsed!.traceSummary));
    assert.ok(parsed!.correlationAnalytics);
    assert.ok(Array.isArray(parsed!.keyExplanations));
    assert.ok(Array.isArray(parsed!.phasesIncluded));
    // Boundary flags survive
    assert.equal(parsed!.readOnly, true);
    assert.equal(parsed!.noPolicyMutation, true);
  });

  it("has trailing newline", () => {
    const pkg = minimalPackage();
    const output = renderComplianceJson(pkg);
    assert.equal(output.at(-1), "\n");
  });

  it("uses 2-space indent", () => {
    const pkg = minimalPackage();
    const output = renderComplianceJson(pkg);
    const lines = output.split("\n");
    // Find an indented line (not the first opening brace)
    for (const line of lines) {
      if (line.startsWith("  ") && !line.startsWith("    ")) {
        // Found a 2-space indented line — verify it's not 4-space
        assert.ok(line.startsWith('  "'));
        return;
      }
    }
    assert.fail("No 2-space indented lines found in JSON output");
  });
});

describe("renderComplianceText (P29.3)", () => {
  it("includes inventory counts", () => {
    const pkg = minimalPackage();
    const output = renderComplianceText(pkg);

    assert.ok(output.includes("Signals:     2"));
    assert.ok(output.includes("Candidates:  1"));
    assert.ok(output.includes("Outcomes:    1"));
    assert.ok(output.includes("Traces:      1"));
  });

  it("includes section headers for all populated sections", () => {
    const pkg = minimalPackage();
    const output = renderComplianceText(pkg);

    assert.ok(output.includes("Signal Summary"));
    assert.ok(output.includes("Candidate Summary"));
    assert.ok(output.includes("Outcome Summary"));
    assert.ok(output.includes("Trace Summary"));
    assert.ok(output.includes("Correlation Analytics"));
    assert.ok(output.includes("Key Explanations"));
    assert.ok(output.includes("Boundary Flags"));
    assert.ok(output.includes("Phases Included"));
  });

  it("shows (none) for empty sections", () => {
    const pkg = minimalPackage({
      signalSummary: [],
      candidateSummary: [],
      outcomeSummary: [],
      traceSummary: [],
      totalSignals: 0,
      totalCandidates: 0,
      totalOutcomes: 0,
      totalTraces: 0,
      keyExplanations: [],
    });
    const output = renderComplianceText(pkg);

    assert.ok(output.includes("(none)"));
    // Still shows the header
    assert.ok(output.includes("Signal Summary"));
    assert.ok(output.includes("Candidate Summary"));
    assert.ok(output.includes("Outcome Summary"));
    assert.ok(output.includes("Trace Summary"));
  });

  it("includes package metadata in header", () => {
    const pkg = minimalPackage();
    const output = renderComplianceText(pkg);

    assert.ok(output.includes("Compliance Package"));
    assert.ok(output.includes(pkg.packageId));
    assert.ok(output.includes(pkg.generatedAt));
    assert.ok(output.includes(pkg.windowStart));
    assert.ok(output.includes(pkg.windowEnd));
  });

  it("includes boundary flags", () => {
    const pkg = minimalPackage();
    const output = renderComplianceText(pkg);

    assert.ok(output.includes("Read-only:        true"));
    assert.ok(output.includes("No policy mut:    true"));
    assert.ok(output.includes("No threshold chg: true"));
    assert.ok(output.includes("No auto-adopt:    true"));
    assert.ok(output.includes("No ranking:       true"));
  });
});
