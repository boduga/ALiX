/**
 * P6.2 — OperatorQueue governance sentinels.
 *
 * Enforces:
 * 1. Purity — OperatorQueue must not import stores or builders
 * 2. No mutation — OperatorQueue must not call lifecycle transitions
 * 3. Intelligence Law — OperatorQueue must not import evaluation modules
 *
 * Pattern: module-level grep on the source file. These are compile-time
 * architectural guards, not runtime tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const QUEUE_SRC = resolve(__dirname, "../../src/adaptation/operator-queue.ts");
const source = readFileSync(QUEUE_SRC, "utf-8");

/** Strip comments from source so sentinel patterns don't false-positive on
 *  JSDoc that explains the rule itself (e.g., "No 'approve because'..."). */
function stripComments(src: string): string {
  // Remove //-style comments and block comments (including JSDoc)
  return src
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const codeOnly = stripComments(source);

describe("P6.2 — OperatorQueue purity sentinel", () => {
  const FORBIDDEN_STORE_IMPORTS = [
    "proposal-store",
    "evidence-store",
    "effectiveness-store",
    "intelligence-store",
    "-store",
  ];

  const FORBIDDEN_BUILDER_IMPORTS = [
    "DecisionContextBuilder",
    "RiskScoreBuilder",
    "RecommendationEngine",
  ];

  for (const forbidden of FORBIDDEN_STORE_IMPORTS) {
    it(`must not import ${forbidden}`, () => {
      expect(codeOnly).not.toContain(forbidden);
    });
  }

  for (const forbidden of FORBIDDEN_BUILDER_IMPORTS) {
    it(`must not import ${forbidden}`, () => {
      expect(codeOnly).not.toContain(forbidden);
    });
  }

  it("must not contain save/update calls", () => {
    expect(codeOnly).not.toMatch(/\.(save|update|approve|apply|reject)\(/);
  });
});

describe("P6.2 — Intelligence Law sentinel", () => {
  const FORBIDDEN_EVALUATION_IMPORTS = [
    "decision-confidence",
    "risk-score",      // scoring functions (not the types module)
    "recommendation-rules",
  ];

  const FORBIDDEN_EVALUATION_PATTERNS = [
    /approve because/i,
    /reject because/i,
    /risk score computed as/i,
  ];

  for (const forbidden of FORBIDDEN_EVALUATION_IMPORTS) {
    it(`must not import evaluation module: ${forbidden}`, () => {
      // Allow imports from types files and the operator-queue-types file itself.
      // Check comment-free source to avoid false positives from JSDoc.
      const lines = codeOnly.split("\n").filter((l) => l.includes(forbidden) && !l.includes("operator-queue-types") && !l.includes("types"));
      expect(lines.length).toBe(0);
    });
  }

  for (const pattern of FORBIDDEN_EVALUATION_PATTERNS) {
    it(`must not contain evaluation language: ${pattern}`, () => {
      // Check comment-free source so JSDoc that explains the rule itself
      // (e.g., "No 'approve because'...") doesn't cause a false positive.
      expect(codeOnly).not.toMatch(pattern);
    });
  }

  it("must not compute confidence", () => {
    // Queue may forward confidence from recommendation, but must not compute it.
    // Forbidden patterns: explicit confidence calculation
    const FORBIDDEN_CONFIDENCE_PATTERNS = [
      "Math.",
      "calculateConfidence",
      "computeConfidence",
      "confidenceScore",
    ];
    for (const pattern of FORBIDDEN_CONFIDENCE_PATTERNS) {
      // Check comment-free source to avoid false positives from JSDoc.
      expect(codeOnly).not.toContain(pattern);
    }
  });
});

describe("P6.2 — orchestration lives in CLI, not queue class", () => {
  it("must not import DecisionContextBuilder, ProposalStore, EvidenceStore by name", () => {
    // The queue class may import types, but must not import builders or stores
    const forbidden = ["DecisionContextBuilder", "ProposalStore", "EvidenceStore"];
    for (const name of forbidden) {
      expect(codeOnly).not.toContain(name);
    }
  });
});
