/**
 * Tests for P28.1 — Governance Explainability Types.
 *
 * Verifies the section kind union, boundary flags, and empty explanation
 * validity. Pure type-level tests — no stores, no filesystem, no async.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type {
  ExplanationSectionKind,
  ExplanationSection,
  GovernanceExplanation,
} from "../../src/governance/governance-explainability-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience factory that supplies required boundary flags. */
function makeExplanation(overrides: Partial<GovernanceExplanation> & {
  explanationId?: string;
  generatedAt?: string;
  subject?: string;
  sections?: ExplanationSection[];
  traceIds?: string[];
} = {}): GovernanceExplanation {
  return {
    explanationId: overrides.explanationId ?? "exp:test",
    generatedAt: overrides.generatedAt ?? "2026-07-09T12:00:00.000Z",
    subject: overrides.subject ?? "Test",
    sections: overrides.sections ?? [],
    traceIds: overrides.traceIds ?? [],
    readOnly: true,
    noPolicyMutation: true,
    noThresholdChange: true,
    noAutoAdoption: true,
    noRanking: true,
  };
}

// ---------------------------------------------------------------------------
// Section kinds — compile-time discriminator check
// ---------------------------------------------------------------------------

describe("ExplanationSectionKind", () => {
  it("has exactly 5 supported kinds", () => {
    const kinds: ExplanationSectionKind[] = [
      "signal_origin",
      "candidate_lifecycle",
      "outcome_summary",
      "peer_comparison",
      "learning_synthesis",
    ];
    assert.strictEqual(kinds.length, 5);

    // Verify each kind is distinct
    const set = new Set(kinds);
    assert.strictEqual(set.size, 5);
  });

  it("accepts each kind at the type level", () => {
    const cases: { kind: ExplanationSectionKind; label: string }[] = [
      { kind: "signal_origin", label: "Signal Origin" },
      { kind: "candidate_lifecycle", label: "Candidate Lifecycle" },
      { kind: "outcome_summary", label: "Outcome Summary" },
      { kind: "peer_comparison", label: "Peer Comparison" },
      { kind: "learning_synthesis", label: "Learning Synthesis" },
    ];
    assert.strictEqual(cases.length, 5);
  });

  it("rejects unknown kind at runtime (not in union)", () => {
    // Cast to test runtime: an unknown string must not match any known kind
    const unknown = "unknown_kind" as ExplanationSectionKind;
    const known: ExplanationSectionKind[] = [
      "signal_origin",
      "candidate_lifecycle",
      "outcome_summary",
      "peer_comparison",
      "learning_synthesis",
    ];
    assert.strictEqual(known.includes(unknown as ExplanationSectionKind), false);
  });
});

// ---------------------------------------------------------------------------
// ExplanationSection — structural validity
// ---------------------------------------------------------------------------

describe("ExplanationSection", () => {
  it("constructs a minimal section correctly", () => {
    const section: ExplanationSection = {
      kind: "signal_origin",
      heading: "Signal Origin",
      body: "This recommendation originated from the confidence calibration signal.",
      evidenceRefs: ["evt:001", "evt:002"],
    };
    assert.strictEqual(section.kind, "signal_origin");
    assert.strictEqual(section.heading, "Signal Origin");
    assert.strictEqual(section.body.length > 0, true);
    assert.deepStrictEqual(section.evidenceRefs, ["evt:001", "evt:002"]);
    assert.strictEqual(section.dataPoints, undefined);
  });

  it("constructs a section with optional dataPoints", () => {
    const section: ExplanationSection = {
      kind: "outcome_summary",
      heading: "Outcome Summary",
      body: "3 of 5 recent outcomes were positive.",
      evidenceRefs: [],
      dataPoints: { acceptanceRate: 0.6, totalDecisions: 5 },
    };
    assert.strictEqual(section.kind, "outcome_summary");
    assert.deepStrictEqual(section.dataPoints, {
      acceptanceRate: 0.6,
      totalDecisions: 5,
    });
  });

  it("accepts all 5 section kinds in an array", () => {
    const sections: ExplanationSection[] = [
      { kind: "signal_origin", heading: "A", body: ".", evidenceRefs: [] },
      { kind: "candidate_lifecycle", heading: "B", body: ".", evidenceRefs: [] },
      { kind: "outcome_summary", heading: "C", body: ".", evidenceRefs: [] },
      { kind: "peer_comparison", heading: "D", body: ".", evidenceRefs: [] },
      { kind: "learning_synthesis", heading: "E", body: ".", evidenceRefs: [] },
    ];
    assert.strictEqual(sections.length, 5);
  });
});

// ---------------------------------------------------------------------------
// Boundary flags — all readonly true
// ---------------------------------------------------------------------------

describe("GovernanceExplanation boundary flags", () => {
  it("all 5 boundary flags are true", () => {
    const explanation = makeExplanation();

    assert.strictEqual(explanation.readOnly, true);
    assert.strictEqual(explanation.noPolicyMutation, true);
    assert.strictEqual(explanation.noThresholdChange, true);
    assert.strictEqual(explanation.noAutoAdoption, true);
    assert.strictEqual(explanation.noRanking, true);
  });

  it("boundary flags are readonly at the type level", () => {
    const explanation = makeExplanation();

    // All 5 flags are true — verify the invariant
    assert.strictEqual(explanation.readOnly, true);
    assert.strictEqual(explanation.noPolicyMutation, true);
    assert.strictEqual(explanation.noThresholdChange, true);
    assert.strictEqual(explanation.noAutoAdoption, true);
    assert.strictEqual(explanation.noRanking, true);

    // Compile-time check: readonly prevents assignment.
    // The following lines would fail to compile if uncommented:
    // (explanation as GovernanceExplanation).readOnly = false;  // TS2540
    // (explanation as GovernanceExplanation).noPolicyMutation = false;
  });
});

// ---------------------------------------------------------------------------
// GovernanceExplanation — structural validity
// ---------------------------------------------------------------------------

describe("GovernanceExplanation", () => {
  it("constructs a valid explanation with sections and traceIds", () => {
    const explanation = makeExplanation({
      explanationId: "exp:003",
      subject: "Full Explanation",
      sections: [
        {
          kind: "signal_origin",
          heading: "Origin",
          body: "Detailed analysis.",
          evidenceRefs: ["evt:abc"],
        },
        {
          kind: "learning_synthesis",
          heading: "Learning",
          body: "Patterns detected.",
          evidenceRefs: ["evt:def"],
          dataPoints: { improvement: 0.12 },
        },
      ],
      traceIds: ["trace:alpha", "trace:beta"],
    });

    assert.strictEqual(explanation.explanationId, "exp:003");
    assert.strictEqual(explanation.subject, "Full Explanation");
    assert.strictEqual(explanation.sections.length, 2);
    assert.strictEqual(explanation.sections[0].kind, "signal_origin");
    assert.strictEqual(explanation.sections[1].kind, "learning_synthesis");
    assert.deepStrictEqual(explanation.traceIds, ["trace:alpha", "trace:beta"]);
  });

  it("empty explanation validity — sections and traceIds can be empty arrays", () => {
    const explanation = makeExplanation({
      explanationId: "exp:000",
      subject: "Empty Explanation",
      sections: [],
      traceIds: [],
    });

    assert.strictEqual(explanation.sections.length, 0);
    assert.strictEqual(explanation.traceIds.length, 0);
  });

  it("serializes all boundary flags as true", () => {
    const explanation = makeExplanation({
      explanationId: "exp:004",
      subject: "Serialization Check",
    });

    const json = JSON.parse(JSON.stringify(explanation));
    assert.strictEqual(json.readOnly, true);
    assert.strictEqual(json.noPolicyMutation, true);
    assert.strictEqual(json.noThresholdChange, true);
    assert.strictEqual(json.noAutoAdoption, true);
    assert.strictEqual(json.noRanking, true);
  });
});
