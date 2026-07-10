/**
 * P28.3 — Governance Explainability Report Renderer Tests.
 *
 * Tests that text and JSON renderers produce correct output:
 * - stable section ordering
 * - P28_FOOTER included in text output
 * - JSON is parseable and structurally correct
 * - No I/O, no side effects, no writes
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GovernanceExplanation, ExplanationSection } from "../../src/governance/governance-explainability-types.js";
import {
  renderExplanationText,
  renderExplanationJson,
  P28_FOOTER,
} from "../../src/governance/governance-explainability-report.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function section(kind: ExplanationSection["kind"], heading: string, body: string): ExplanationSection {
  return {
    kind,
    heading,
    body,
    evidenceRefs: [],
  };
}

function fullExplanation(overrides: Partial<GovernanceExplanation> = {}): GovernanceExplanation {
  return {
    explanationId: "abc123def456",
    generatedAt: "2026-07-09T12:00:00.000Z",
    subject: "Adjust performance threshold",
    sections: [
      section("signal_origin", "Signal Origin", "Signal kind: performance_drop, severity: high."),
      section("candidate_lifecycle", "Candidate Lifecycle", "Time to review: 2 days, time to outcome: 5 days."),
      section("outcome_summary", "Outcome Summary", "Outcome type: approved, rationale: aligned with goals."),
      section("learning_synthesis", "Learning Synthesis", "Review cycle: 2 days to review, 5 days to outcome."),
    ],
    traceIds: ["outcome-1"],
    readOnly: true,
    noPolicyMutation: true,
    noThresholdChange: true,
    noAutoAdoption: true,
    noRanking: true,
    ...overrides,
  };
}

function fullExplanationWithPeers(): GovernanceExplanation {
  return {
    ...fullExplanation(),
    sections: [
      ...fullExplanation().sections.slice(0, 3),
      section("peer_comparison", "Peer Comparison", "Among 3 peers in the same signal category."),
      fullExplanation().sections[3], // learning_synthesis
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P28.3 — Governance Explainability Report", () => {
  describe("renderExplanationText", () => {
    it("produces output starting with P28-EXPLAIN-START and ending with P28-EXPLAIN-END", () => {
      const explanation = fullExplanation();
      const output = renderExplanationText(explanation);

      assert.ok(output.startsWith("P28-EXPLAIN-START"), "output should start with P28-EXPLAIN-START");
      assert.ok(output.endsWith("P28-EXPLAIN-END"), "output should end with P28-EXPLAIN-END");
    });

    it("renders subject on its own line after header", () => {
      const explanation = fullExplanation();
      const output = renderExplanationText(explanation);
      const lines = output.split("\n");

      // After "P28-EXPLAIN-START" and blank line, subject should appear
      assert.ok(lines.includes(explanation.subject), "output must include subject");
      const subjectIdx = lines.indexOf(explanation.subject);
      const startIdx = lines.indexOf("P28-EXPLAIN-START");
      assert.ok(subjectIdx > startIdx, "subject must appear after P28-EXPLAIN-START");
    });

    it("renders sections in canonical order: signal_origin, candidate_lifecycle, outcome_summary, peer_comparison, learning_synthesis", () => {
      const explanation = fullExplanationWithPeers();
      const output = renderExplanationText(explanation);
      const lines = output.split("\n");

      const expectedHeadings = [
        "Signal Origin",
        "Candidate Lifecycle",
        "Outcome Summary",
        "Peer Comparison",
        "Learning Synthesis",
      ];

      const foundIndexes: number[] = [];
      for (const heading of expectedHeadings) {
        const idx = lines.findIndex((l) => l.includes(`=== ${heading} ===`));
        assert.notStrictEqual(idx, -1, `should find heading "${heading}"`);
        foundIndexes.push(idx);
      }

      // Verify order
      for (let i = 1; i < foundIndexes.length; i++) {
        assert.ok(
          foundIndexes[i] > foundIndexes[i - 1],
          `section ${expectedHeadings[i]} should appear after ${expectedHeadings[i - 1]}`,
        );
      }
    });

    it("includes P28_FOOTER in output before P28-EXPLAIN-END", () => {
      const explanation = fullExplanation();
      const output = renderExplanationText(explanation);

      assert.ok(output.includes(P28_FOOTER), "output must contain P28_FOOTER");

      const footerIdx = output.indexOf(P28_FOOTER);
      const endIdx = output.indexOf("P28-EXPLAIN-END");
      assert.ok(footerIdx < endIdx, "footer must appear before P28-EXPLAIN-END");
    });

    it("skips sections not present in the explanation", () => {
      // fullExplanation doesn't have peer_comparison
      const explanation = fullExplanation();
      const output = renderExplanationText(explanation);

      assert.ok(!output.includes("=== Peer Comparison ==="), "should skip peer_comparison when absent");
    });

    it("renders each section body text", () => {
      const explanation = fullExplanation();
      const output = renderExplanationText(explanation);

      for (const section of explanation.sections) {
        assert.ok(output.includes(section.body), `output must include body text for ${section.kind}`);
      }
    });

    it("renders dataPoints when present", () => {
      const sections: ExplanationSection[] = [
        {
          kind: "signal_origin",
          heading: "Signal Origin",
          body: "Test body.",
          evidenceRefs: [],
          dataPoints: { severity: "high", confidence: 0.85 },
        },
      ];
      const explanation: GovernanceExplanation = {
        ...fullExplanation(),
        sections,
      };

      const output = renderExplanationText(explanation);
      assert.ok(output.includes("  severity: high"), "should render dataPoint severity");
      assert.ok(output.includes("  confidence: 0.85"), "should render dataPoint confidence");
    });

    it("renders evidenceRefs when present", () => {
      const sections: ExplanationSection[] = [
        {
          kind: "signal_origin",
          heading: "Signal Origin",
          body: "Test body.",
          evidenceRefs: ["ref-1", "ref-2"],
        },
      ];
      const explanation: GovernanceExplanation = {
        ...fullExplanation(),
        sections,
      };

      const output = renderExplanationText(explanation);
      assert.ok(output.includes("references: ref-1, ref-2"), "should render evidence refs");
    });
  });

  describe("renderExplanationJson", () => {
    it("produces valid JSON that can be parsed", () => {
      const explanation = fullExplanation();
      const json = renderExplanationJson(explanation);

      assert.doesNotThrow(() => {
        JSON.parse(json);
      }, "JSON output must be parseable");
    });

    it("preserves all top-level fields", () => {
      const explanation = fullExplanation();
      const json = renderExplanationJson(explanation);
      const parsed = JSON.parse(json) as GovernanceExplanation;

      assert.strictEqual(parsed.explanationId, explanation.explanationId);
      assert.strictEqual(parsed.subject, explanation.subject);
      assert.strictEqual(parsed.readOnly, true);
      assert.strictEqual(parsed.noPolicyMutation, true);
      assert.strictEqual(parsed.noThresholdChange, true);
      assert.strictEqual(parsed.noAutoAdoption, true);
      assert.strictEqual(parsed.noRanking, true);
      assert.deepStrictEqual(parsed.traceIds, explanation.traceIds);
    });

    it("preserves all sections with their fields", () => {
      const explanation = fullExplanationWithPeers();
      const json = renderExplanationJson(explanation);
      const parsed = JSON.parse(json) as GovernanceExplanation;

      assert.strictEqual(parsed.sections.length, explanation.sections.length);
      for (let i = 0; i < parsed.sections.length; i++) {
        assert.strictEqual(parsed.sections[i].kind, explanation.sections[i].kind);
        assert.strictEqual(parsed.sections[i].heading, explanation.sections[i].heading);
        assert.strictEqual(parsed.sections[i].body, explanation.sections[i].body);
        assert.deepStrictEqual(parsed.sections[i].evidenceRefs, explanation.sections[i].evidenceRefs);
        assert.deepStrictEqual(parsed.sections[i].dataPoints, explanation.sections[i].dataPoints);
      }
    });

    it("JSON output is indented with 2 spaces", () => {
      const explanation = fullExplanation();
      const json = renderExplanationJson(explanation);
      const lines = json.split("\n");

      // Check that content lines (not array/object brackets) are indented
      for (const line of lines) {
        if (line.trim().startsWith('"')) {
          assert.ok(line.startsWith("  "), `line should be indented: "${line}"`);
        }
      }
    });
  });

  describe("P28_FOOTER constant", () => {
    it("contains expected sections", () => {
      assert.ok(P28_FOOTER.includes("P28 explains governance decisions already made."));
      assert.ok(P28_FOOTER.includes("does not recommend, predict, or prescribe actions."));
      assert.ok(P28_FOOTER.includes("No policy was changed. No thresholds were adjusted."));
      assert.ok(P28_FOOTER.includes("No reviewers were ranked. No outcomes were predicted."));
    });
  });

  describe("Engine invariants", () => {
    it("renderExplanationText is a pure function with no side effects", () => {
      const explanation = fullExplanation();
      const before = JSON.stringify(explanation);
      renderExplanationText(explanation);
      const after = JSON.stringify(explanation);
      assert.strictEqual(after, before, "explanation must not be mutated");
    });

    it("renderExplanationJson is a pure function with no side effects", () => {
      const explanation = fullExplanation();
      const before = JSON.stringify(explanation);
      renderExplanationJson(explanation);
      const after = JSON.stringify(explanation);
      assert.strictEqual(after, before, "explanation must not be mutated");
    });
  });
});
