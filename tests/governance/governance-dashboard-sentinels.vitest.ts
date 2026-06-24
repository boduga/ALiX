/**
 * P9.5 — Governance Dashboard purity sentinel.
 *
 * Scans the 3 dashboard files for any mutation write path. Fails the test
 * if any forbidden symbol is found. Read-only store queries are permitted.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD_FILES = [
  "src/governance/governance-dashboard.ts",
  "src/cli/commands/governance-dashboard-renderer.ts",
  "src/cli/commands/governance-dashboard-handler.ts",
];

const FORBIDDEN_IN_DASHBOARD = [
  // Mutation appliers
  "GovernanceChangeApplier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  // Approval / apply / reject verbs (string-form, not import)
  ".approve(",
  ".apply(",
  ".reject(",
  // Mutation-write stores
  "ProposalStore.save",
  "ProposalStore.markOrphaned",
  // Evidence write methods
  "recordGovernanceMutationApplied",
  "recordAdaptationApproved",
  "recordAdaptationApplied",
  "recordAdaptationRejected",
  "recordAdaptationFailed",
  "recordRevertApplied",
  "recordRevertFailed",
];

describe("P9.5 dashboard purity sentinel", () => {
  for (const relPath of DASHBOARD_FILES) {
    it(`${relPath} does not import any mutation write path`, () => {
      const absPath = join(process.cwd(), relPath);
      if (!existsSync(absPath)) {
        throw new Error(`Dashboard file missing: ${relPath}. Sentinel expects 3 files; run earlier tasks first.`);
      }
      const content = readFileSync(absPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const forbidden of FORBIDDEN_IN_DASHBOARD) {
          if (line.includes(forbidden)) {
            throw new Error(
              `P9.5 dashboard purity violation at ${relPath}:${i + 1}\n` +
              `  Found forbidden symbol: "${forbidden}"\n` +
              `  The dashboard is read-only and must not import mutation write paths.\n` +
              `  If this symbol is needed, it belongs in a non-dashboard module.`,
            );
          }
        }
      }
    });
  }
});