/**
 * P8.5a.2d — Adapter Purity Invariant sentinel.
 *
 * Structural enforcement of the rule that the 3 calibration adapters MUST
 * NOT import any mutation surface. A single rogue import anywhere in any
 * adapter file fails the suite loudly.
 *
 * Mirrors the P8.5a.0 Evidence Chain import sentinel. The structural
 * check is the primary defense; per-test inline checks in each adapter's
 * vitest file are secondary.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const REPO_ROOT = process.cwd();

const ADAPTER_FILES = [
  "src/learning/recommendation-calibration-adapter.ts",
  "src/learning/risk-calibration-adapter.ts",
  "src/learning/governance-calibration-adapter.ts",
];

const FORBIDDEN_IMPORTS = [
  "LearningStore",
  "ProposalStore",
  "ApprovalGate",
  "AdaptationProposalStore",
  "AutomaticProposalGenerator",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
];

describe("adapter purity invariant (P8.5a.2d)", () => {
  for (const rel of ADAPTER_FILES) {
    describe(rel, () => {
      const src = readFileSync(`${REPO_ROOT}/${rel}`, "utf-8");
      const importLines = src
        .split("\n")
        .filter((l) => l.trim().startsWith("import"));

      it("file is readable and has at least one import", () => {
        expect(importLines.length).toBeGreaterThan(0);
      });

      for (const forbidden of FORBIDDEN_IMPORTS) {
        it(`does not import ${forbidden}`, () => {
          for (const line of importLines) {
            expect(
              line,
              `${rel} must not import ${forbidden} (mutates Learning=Mutation invariant)`,
            ).not.toContain(forbidden);
          }
        });
      }
    });
  }
});
