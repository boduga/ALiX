/**
 * P9.0f/P9.1 — Purity sentinel: structural enforcement of P9 governance invariants.
 *
 * P9 may write only GovernanceStore. All 6 P8 stores are explicitly forbidden:
 * OutcomeStore, ApprovalRecommendationStore, RiskScoreStore, GovernanceReviewStore,
 * LearningStore, EvidenceChainStore. Additionally forbids proposal/applier symbols
 * to structurally eliminate self-mutation risk.
 *
 * P9.1 extends coverage to include governance-recommendation-generator.ts, the
 * recommendation-emission surface of the governance pipeline. It must satisfy the
 * same import + write-call purity rules as governance-store.ts and the CLI.
 *
 * Rules (per file category):
 *   - BUILDERS (5 files): check write calls ONLY (imports legitimately read P8 stores)
 *   - STORE + CLI + GENERATOR (3 files): check BOTH imports AND write calls
 *   - governance-store.ts EXTRA: must not reference P8 store path strings
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Forbidden surfaces
// ---------------------------------------------------------------------------

/**
 * Symbols that P9 must never import. These represent P8 mutation surface
 * (stores, gates, appliers, proposal generators) that would give P9 the
 * ability to self-modify governance.
 */
const FORBIDDEN_IMPORTS = [
  "OutcomeStore",
  "ApprovalRecommendationStore",
  "RiskScoreStore",
  "GovernanceReviewStore",
  "LearningStore",
  "EvidenceChainStore",
  "ProposalStore",
  "ApprovalGate",
  "AdaptationProposalStore",
  "AutomaticProposalGenerator",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  "runLearningRefresh",
  "GovernanceRecommendation",
  "GovernanceProposal",
  "governance_change",
  "createGovernanceProposal",
];

/**
 * Write/append/mutation method calls that P9 must never invoke.
 * P9 may call GovernanceStore.append() only — no other write surface.
 */
const FORBIDDEN_WRITE_CALLS = [
  "appendSignal(",
  "appendProfile(",
  "appendReport(",
  "appendChain(",
  "write(",
  "writeFile(",
  "appendFile(",
  "save(",
  "recordOutcome(",
  "createProposal(",
  "approveProposal(",
  "applyProposal(",
  "rejectProposal(",
  "runLearningRefresh(",
];

// ---------------------------------------------------------------------------
// File categories
// ---------------------------------------------------------------------------

/**
 * Governance builders legitimately read P8 stores (GovernanceReviewStore,
 * OutcomeStore, LearningStore) as their data source. We skip the import
 * check for these files, but we still verify they never call P8 mutation
 * methods.
 */
const GOVERNANCE_BUILDERS = [
  "src/governance/governance-health-builder.ts",
  "src/governance/governance-assessment.ts",
  "src/governance/governance-integrity.ts",
  "src/governance/governance-drift-detector.ts",
  "src/governance/governance-lens-review.ts",
];

/**
 * All P9 governance files covered by this sentinel.
 */
const ALL_FILES = [
  ...GOVERNANCE_BUILDERS,
  "src/governance/governance-store.ts",
  "src/governance/governance-recommendation-generator.ts",
  "src/cli/commands/governance.ts",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSource(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf-8");
}

// ---------------------------------------------------------------------------
// Sentinel tests
// ---------------------------------------------------------------------------

describe("P9.0 purity sentinel", () => {
  // -- Import checks (store + CLI only) ------------------------------------

  for (const file of ALL_FILES) {
    it(`${file} has no forbidden imports`, () => {
      const source = readSource(file);

      // Governance builders legitimately read P8 stores — skip import check
      if (GOVERNANCE_BUILDERS.includes(file)) return;

      const importLines = source
        .split("\n")
        .filter((l) => l.trim().startsWith("import"));

      for (const line of importLines) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(
            line,
            `${file} imports forbidden symbol: ${forbidden}`,
          ).not.toContain(forbidden);
        }
      }
    });
  }

  // -- Write call checks (all 7 files) -------------------------------------

  for (const file of ALL_FILES) {
    it(`${file} never calls P8 mutation methods`, () => {
      const source = readSource(file);

      for (const call of FORBIDDEN_WRITE_CALLS) {
        expect(
          source,
          `${file} contains forbidden write call: ${call}`,
        ).not.toContain(call);
      }
    });
  }

  // -- governance-store.ts path isolation -----------------------------------

  it("governance-store.ts must not reference any P8 store directory names", () => {
    const source = readSource("src/governance/governance-store.ts");

    const FORBIDDEN_PATHS = [
      "outcomes",
      "risk-scores",
      "governance-reviews",
      "learning",
      "evidence-chains",
    ];

    for (const path of FORBIDDEN_PATHS) {
      expect(
        source,
        `governance-store.ts references forbidden P8 store path "${path}"`,
      ).not.toContain(path);
    }
  });
});
