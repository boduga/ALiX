/**
 * P6.3 — StrategicBrief governance sentinels.
 *
 * Enforces:
 * 1. Purity — StrategicBriefBuilder must not import stores or builders
 * 2. No proposal IDs in findings/summaries/actions (static source scan)
 * 3. No per-proposal directive language in source
 *
 * Dependency claims are checked against the real import graph (#697); language
 * checks run on comment-stripped text.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importedSpecifiers, importedBindings, codeOnly } from "../helpers/import-graph.js";

const BRIEF_SRC = resolve(__dirname, "../../src/adaptation/strategic-brief.ts");
const source = readFileSync(BRIEF_SRC, "utf-8");
const specifiers = [...importedSpecifiers(BRIEF_SRC)];
const bindings = importedBindings(BRIEF_SRC);
const code = codeOnly(source);

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
      expect(specifiers.some((s) => s.includes(forbidden))).toBe(false);
    });
  }

  for (const forbidden of FORBIDDEN_BUILDER_IMPORTS) {
    it(`must not import ${forbidden}`, () => {
      expect(bindings.has(forbidden)).toBe(false);
    });
  }

  it("must not contain save/update/mutation calls", () => {
    expect(code).not.toMatch(/\.(save|update|approve|apply|reject)\(/);
  });

  it("must not import decision-confidence or scoring modules", () => {
    const forbidden = ["decision-confidence", "risk-score", "recommendation-rules"];
    for (const pattern of forbidden) {
      // Allow type-only references (risk-score-types is OK)
      const offending = specifiers.filter((s) => s.includes(pattern) && !s.includes("types"));
      expect(offending, `imports ${pattern}`).toEqual([]);
    }
  });
});

describe("P6.3 — No proposal-ID sentinel (static)", () => {
  it("source must not contain prop- string literals in output content areas", () => {
    const lines = code.split("\n").filter((line) => {
      const trimmed = line.trim();
      // Skip import lines — they reference proposal-related types
      if (trimmed.startsWith("import ")) return false;
      return /["']prop-/.test(trimmed);
    });
    expect(lines).toEqual([]);
  });
});

describe("P6.3 — No per-proposal recommendation sentinel", () => {
  it("source must not contain approve/reject proposal directives", () => {
    expect(code).not.toMatch(/["']approve proposal["']/);
    expect(code).not.toMatch(/["']reject proposal["']/);
    expect(code).not.toMatch(/["']approve prop-/);
    expect(code).not.toMatch(/["']reject prop-/);

    // The words approve/reject ARE allowed as historical metrics
    // e.g. "approval rate decreased" or "rejection-like outcomes"
    // Those appear in strings only, so we only check for directive patterns
  });
});
