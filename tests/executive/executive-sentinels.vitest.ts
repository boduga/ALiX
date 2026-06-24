/**
 * P10.0 — Executive purity sentinel: structural enforcement of executive read-only invariant.
 *
 * The P10.0 Executive Intelligence layer is strictly read-only. It MUST NOT mutate any
 * store, invoke any applier, or perform any action that could alter the state of the
 * system. The only writes it may perform are to its own local ExecutiveHealth snapshot
 * (if at all — even that is non-mutating to the rest of the system).
 *
 * This sentinel scans each P10.0 executive file line-by-line and fails if any forbidden
 * mutation symbol appears. The intent is to fail-closed at the boundary: if a future
 * change accidentally introduces a mutation surface into the executive layer, the
 * sentinel fails before the change can be merged.
 *
 * Rules:
 *   - One test per P10.0 executive file (10 tests total).
 *   - For each line, if it .includes(any forbidden substring), throw a descriptive
 *     error with file:line.
 *   - Implementer may tighten regex (e.g., require word boundary) on false positive,
 *     but MUST NOT relax the forbidden list.
 *
 * @module
 */

import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The 10 P10.0 executive files
// ---------------------------------------------------------------------------

const EXECUTIVE_FILES = [
  "src/executive/executive-health.ts",
  "src/executive/adapters/agent-health.ts",
  "src/executive/adapters/tool-health.ts",
  "src/executive/adapters/workflow-health.ts",
  "src/executive/adapters/memory-health.ts",
  "src/executive/adapters/security-health.ts",
  "src/executive/adapters/adaptation-health.ts",
  "src/cli/commands/executive-dashboard-renderer.ts",
  "src/cli/commands/executive-dashboard-handler.ts",
  "src/cli/commands/executive.ts",
];

// ---------------------------------------------------------------------------
// Forbidden mutation symbols (mirrors P9.5 purity sentinel pattern)
// ---------------------------------------------------------------------------

/**
 * Mutation surfaces that P10.0 must never touch. These represent the entire
 * mutation path: appliers (write-target dispatchers), action method calls
 * (.approve/.apply/.reject), store mutation methods, and outcome-recording
 * functions. Any of these in a P10.0 executive file would break the
 * Executive Read-Only invariant.
 */
const FORBIDDEN_IN_EXECUTIVE = [
  "GovernanceChangeApplier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSource(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf-8");
}

// ---------------------------------------------------------------------------
// Sentinel tests — one per file
// ---------------------------------------------------------------------------

describe("P10.0 executive purity sentinel", () => {
  for (const file of EXECUTIVE_FILES) {
    it(`${file} has no mutation write paths`, () => {
      // 1. Read the file. If missing, throw an error referencing the missing path.
      const source = readSource(file);
      const lines = source.split("\n");

      // 2. For each line, check if it `.includes(forbidden)`.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 3. If any forbidden substring is found, throw a descriptive error with `file:line`.
        for (const forbidden of FORBIDDEN_IN_EXECUTIVE) {
          if (line.includes(forbidden)) {
            throw new Error(
              `Executive purity violation in ${file}:${i + 1} — ` +
              `forbidden symbol "${forbidden}" found in line: ${line.trim()}`,
            );
          }
        }
      }
    });
  }
});
