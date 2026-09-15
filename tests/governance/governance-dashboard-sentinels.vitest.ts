/**
 * P9.5 — Governance Dashboard purity sentinel.
 *
 * Scans the 3 dashboard files for any mutation write path. Fails if a mutation
 * symbol is imported or a write call appears. Read-only store queries are
 * permitted.
 *
 * Dependency claims use the real import graph (#697); call-site scans run on
 * comment-stripped code.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { importedBindings, codeOnly } from "../helpers/import-graph.js";

const DASHBOARD_FILES = [
  "src/governance/governance-dashboard.ts",
  "src/cli/commands/governance-dashboard-renderer.ts",
  "src/cli/commands/governance-dashboard-handler.ts",
];

// Mutation appliers that must never be imported.
const FORBIDDEN_IMPORTS = [
  "GovernanceChangeApplier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
];

// Write paths that must never appear in dashboard code.
const FORBIDDEN_CODE = [
  ".approve(",
  ".apply(",
  ".reject(",
  "ProposalStore.save",
  "ProposalStore.markOrphaned",
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
      const bindings = importedBindings(absPath);
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(bindings.has(forbidden), `imports ${forbidden}`).toBe(false);
      }

      const code = codeOnly(readFileSync(absPath, "utf-8"));
      for (const forbidden of FORBIDDEN_CODE) {
        expect(code.includes(forbidden), `contains write path "${forbidden}"`).toBe(false);
      }
    });
  }
});
