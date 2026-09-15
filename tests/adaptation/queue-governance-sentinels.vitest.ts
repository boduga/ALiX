/**
 * P6.2 — OperatorQueue governance sentinels.
 *
 * Enforces:
 * 1. Purity — OperatorQueue must not import stores or builders
 * 2. No mutation — OperatorQueue must not call lifecycle transitions
 * 3. Intelligence Law — OperatorQueue must not import evaluation modules
 *
 * Dependency claims are checked against the real import graph (#697), not a
 * whole-file substring scan; code-language checks run on comment-stripped text.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importedSpecifiers, importedBindings, codeOnly as stripComments } from "../helpers/import-graph.js";

const QUEUE_SRC = resolve(__dirname, "../../src/adaptation/operator-queue.ts");
const source = readFileSync(QUEUE_SRC, "utf-8");
const codeOnly = stripComments(source);
const specifiers = [...importedSpecifiers(QUEUE_SRC)];
const bindings = importedBindings(QUEUE_SRC);

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
      expect(specifiers.some((s) => s.includes(forbidden))).toBe(false);
    });
  }

  for (const forbidden of FORBIDDEN_BUILDER_IMPORTS) {
    it(`must not import ${forbidden}`, () => {
      expect(bindings.has(forbidden)).toBe(false);
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
      // Specifier-anchored: allow type-only modules (operator-queue-types).
      const offending = specifiers.filter(
        (s) => s.includes(forbidden) && !s.includes("operator-queue-types") && !s.includes("types"),
      );
      expect(offending).toEqual([]);
    });
  }

  for (const pattern of FORBIDDEN_EVALUATION_PATTERNS) {
    it(`must not contain evaluation language: ${pattern}`, () => {
      expect(codeOnly).not.toMatch(pattern);
    });
  }

  it("must not compute confidence", () => {
    // Queue may forward confidence from recommendation, but must not compute it.
    const FORBIDDEN_CONFIDENCE_PATTERNS = [
      "Math.",
      "calculateConfidence",
      "computeConfidence",
      "confidenceScore",
    ];
    for (const pattern of FORBIDDEN_CONFIDENCE_PATTERNS) {
      expect(codeOnly).not.toContain(pattern);
    }
  });
});

describe("P6.2 — orchestration lives in CLI, not queue class", () => {
  it("must not import DecisionContextBuilder, ProposalStore, EvidenceStore by name", () => {
    const forbidden = ["DecisionContextBuilder", "ProposalStore", "EvidenceStore"];
    for (const name of forbidden) {
      expect(bindings.has(name), `imports ${name}`).toBe(false);
    }
  });
});
