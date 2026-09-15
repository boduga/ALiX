/**
 * P8.5a.2d — Adapter Purity Invariant sentinel.
 *
 * Structural enforcement of the rule that the 3 calibration adapters MUST
 * NOT import any mutation surface. A single rogue import anywhere in any
 * adapter file fails the suite loudly.
 *
 * Dependency claims are checked against the real import graph (#697), so a
 * comment or unrelated mention can no longer satisfy them.
 */

import { describe, it, expect } from "vitest";
import { importedBindings, importedSpecifiers } from "../helpers/import-graph.js";

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
      const abs = `${REPO_ROOT}/${rel}`;
      const bindings = importedBindings(abs);
      const specifiers = [...importedSpecifiers(abs)];

      it("file is readable and has at least one import", () => {
        expect(specifiers.length).toBeGreaterThan(0);
      });

      for (const forbidden of FORBIDDEN_IMPORTS) {
        it(`does not import ${forbidden}`, () => {
          const importedByName = bindings.has(forbidden);
          const importedByPath = specifiers.some((s) => s.includes(forbidden));
          expect(
            importedByName || importedByPath,
            `${rel} must not import ${forbidden} (mutates Learning=Mutation invariant)`,
          ).toBe(false);
        });
      }
    });
  }
});
