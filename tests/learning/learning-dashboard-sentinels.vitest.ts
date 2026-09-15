/**
 * P8.5b.4 — Dashboard module purity sentinel.
 *
 * Structurally enforces the read-only invariant: the three dashboard source
 * files MUST NOT import any mutation surface or call any write method.
 *
 * 3 files × 3 assertions = 9 cases:
 *   1. No forbidden imports (ProposalStore, ApprovalGate, …)
 *   2. No mutation method calls (.appendSignal(, .appendProfile(, …)
 *   3. No node:fs write APIs (appendFileSync, writeFileSync, createWriteStream)
 *
 * Dependency claims use the real import graph (#697); call-site scans run on
 * comment-stripped code. The aggregator (learning-dashboard.ts) legitimately
 * imports LearningStore and EvidenceChainStore for read-only consumption —
 * these are NOT in the forbidden-import list.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importedBindings, importedSpecifiers, codeOnly } from "../helpers/import-graph.js";

const FORBIDDEN_IMPORTS = [
  "ProposalStore",
  "ApprovalGate",
  "AdaptationProposalStore",
  "AutomaticProposalGenerator",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  "runLearningRefresh",
];

const DASHBOARD_FILES = [
  "src/learning/dashboard-integrity-score.ts",
  "src/learning/learning-dashboard.ts",
  "src/cli/commands/dashboard-renderer.ts",
];

const FORBIDDEN_WRITE_CALLS = [
  ".appendSignal(",
  ".appendProfile(",
  ".appendReport(",
  ".appendChain(",
  ".write(",
  ".writeFile(",
  ".appendFile(",
  ".save(",
  ".recordOutcome(",
  ".createProposal(",
  ".approveProposal(",
  ".applyProposal(",
  ".rejectProposal(",
  "runLearningRefresh(",
  "update_agent_card",
  "add_capability",
  "adjust_skill_definition",
];

const FORBIDDEN_FS_WRITES = ["appendFileSync", "writeFileSync", "createWriteStream"];

function resolvePath(relativePath: string): string {
  // Package root is two levels up from tests/learning/
  return join(import.meta.dirname, "..", "..", relativePath);
}

describe("P8.5b.4 — Dashboard module purity sentinel", () => {
  for (const file of DASHBOARD_FILES) {
    const absPath = resolvePath(file);

    describe(`${file}`, () => {
      // --- Assertion 1: No forbidden imports ---
      it("has no forbidden imports", () => {
        const bindings = importedBindings(absPath);
        const specifiers = [...importedSpecifiers(absPath)];
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(
            bindings.has(forbidden) || specifiers.some((s) => s.includes(forbidden)),
            `imports ${forbidden}`,
          ).toBe(false);
        }
      });

      // --- Assertion 2: No mutation method calls ---
      it("has no mutation method calls", () => {
        const code = codeOnly(readFileSync(absPath, "utf-8"));
        for (const forbidden of FORBIDDEN_WRITE_CALLS) {
          expect(code.includes(forbidden), `calls ${forbidden}`).toBe(false);
        }
      });

      // --- Assertion 3: No node:fs write APIs ---
      it("has no node:fs write APIs", () => {
        const code = codeOnly(readFileSync(absPath, "utf-8"));
        for (const forbidden of FORBIDDEN_FS_WRITES) {
          expect(code.includes(forbidden), `uses ${forbidden}`).toBe(false);
        }
      });
    });
  }
});
