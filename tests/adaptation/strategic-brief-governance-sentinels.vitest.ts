/**
 * P6.3 — StrategicBrief governance sentinels.
 *
 * Enforces:
 * 1. Purity — StrategicBriefBuilder must not import stores or builders
 * 2. No proposal IDs in findings/summaries/actions (static source grep)
 * 3. No per-proposal directive language in source
 *
 * Pattern: module-level grep on the source file. These are compile-time
 * architectural guards, not runtime tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BRIEF_SRC = resolve(__dirname, "../../src/adaptation/strategic-brief.ts");
const source = readFileSync(BRIEF_SRC, "utf-8");

/** Strip comments from source so sentinel patterns don't false-positive on
 *  JSDoc that explains the rule itself. */
function stripComments(src: string): string {
  return src
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const codeOnly = stripComments(source);

describe("P6.3 — StrategicBrief purity sentinel", () => {
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
    "OperatorQueue",
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

  it("must not contain save/update/mutation calls", () => {
    expect(codeOnly).not.toMatch(/\.(save|update|approve|apply|reject)\(/);
  });

  it("must not import decision-confidence or scoring modules", () => {
    const forbidden = ["decision-confidence", "risk-score", "recommendation-rules"];
    for (const pattern of forbidden) {
      // Allow type-only references (risk-score-types is OK)
      const lines = codeOnly.split("\n").filter(
        (l) => l.includes(pattern) && !l.includes("types"),
      );
      expect(lines.length).toBe(0);
    }
  });

  it("must not import scoring/evaluation modules", () => {
    // The Brief legitimately computes data-sufficiency confidence via Math.min.
    // But it must not import risk-scoring or recommendation modules.
    const forbiddenEval = ["risk-score", "recommendation-rules", "decision-confidence"];
    for (const pattern of forbiddenEval) {
      const lines = codeOnly.split("\n").filter(
        (l) => l.includes(pattern) && !l.includes("types"),
      );
      expect(lines.length).toBe(0);
    }
  });
});

describe("P6.3 — No proposal-ID sentinel (static)", () => {
  it("source must not contain prop- string literals in output content areas", () => {
    // Check that output-construction areas don't hardcode proposal IDs
    // Comments are stripped so JSDoc examples don't false-positive
    const lines = source.split("\n").filter((line) => {
      const trimmed = line.trim();
      // Skip import lines — they reference proposal-related types
      if (trimmed.startsWith("import ")) return false;
      // Skip lines that are comments about the rule itself
      if (trimmed.includes("no proposal IDs") || trimmed.includes("No proposal-ID")) return false;
      // Check for prop- string literals
      return /["']prop-/.test(trimmed);
    });
    expect(lines.length).toBe(0);
  });
});

describe("P6.3 — No per-proposal recommendation sentinel", () => {
  it("source must not contain approve/reject proposal directives", () => {
    // Check comment-free source for directive language
    expect(codeOnly).not.toMatch(/["']approve proposal["']/);
    expect(codeOnly).not.toMatch(/["']reject proposal["']/);
    expect(codeOnly).not.toMatch(/["']approve prop-/);
    expect(codeOnly).not.toMatch(/["']reject prop-/);

    // The words approve/reject ARE allowed as historical metrics
    // e.g. "approval rate decreased" or "rejection-like outcomes"
    // Those appear in strings only, so we only check for directive patterns
  });
});
