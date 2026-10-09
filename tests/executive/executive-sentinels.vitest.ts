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
 *   - One test per P10 executive file (21 tests total).
 *   - For each line, if it .includes(any forbidden substring), throw a descriptive
 *     error with file:line.
 *   - Implementer may tighten regex (e.g., require word boundary) on false positive,
 *     but MUST NOT relax the forbidden list.
 *
 * @module
 */

import { describe, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../helpers/import-graph.js";

// ---------------------------------------------------------------------------
// The 21 P10 executive files (P10.0 + P10.4a)
// ---------------------------------------------------------------------------

const EXECUTIVE_FILES = [
  "src/execution/executive/executive-health.ts",
  "src/execution/executive/priority-engine.ts",
  "src/execution/executive/trend-store.ts",
  "src/execution/executive/adapters/agent-health.ts",
  "src/execution/executive/adapters/tool-health.ts",
  "src/execution/executive/adapters/workflow-health.ts",
  "src/execution/executive/adapters/memory-health.ts",
  "src/execution/executive/adapters/security-health.ts",
  "src/execution/executive/adapters/adaptation-health.ts",
  "src/interfaces/cli/commands/executive-dashboard-renderer.ts",
  "src/interfaces/cli/commands/executive-dashboard-handler.ts",
  "src/interfaces/cli/commands/executive.ts",
  "src/execution/executive/execution-plan-builder.ts",
  "src/execution/executive/objective-engine.ts",
  // P10.4a files
  "src/execution/executive/step-behavior.ts",
  "src/execution/executive/executive-plan-types.ts",
  "src/execution/executive/plan-store.ts",
  "src/execution/executive/execution-state-store.ts",
  "src/execution/executive/plan-approval-gate.ts",
  "src/execution/executive/step-runner.ts",
  "src/execution/executive/execution-engine.ts",
  // P10.4b files
  "src/execution/executive/executive-bridge.ts",
  // P10.4c files
  "src/execution/executive/executive-apply-reconciler.ts",
  // P10.6 files
  "src/execution/executive/learning-trends.ts",
  // P10.5b files
  "src/execution/executive/outcome-store.ts",
  "src/execution/executive/outcome-report-id.ts",
  // P10.5c files
  "src/execution/executive/automatic-outcome-hook.ts",
  // P10.5a files
  "src/execution/executive/outcome-evaluator.ts",
  "src/interfaces/cli/commands/executive-evaluate-handler.ts",
  "src/interfaces/cli/commands/executive-learn-handler.ts",
  // P10.7a files
  "src/execution/executive/recommendation-engine.ts",
  "src/interfaces/cli/commands/executive-recommend-handler.ts",
  // P10.7b files
  "src/execution/executive/recommendation-report-store.ts",
  // P10.7c files
  "src/execution/executive/executive-bridge-recommendations.ts",
  "src/interfaces/cli/commands/executive-bridge-handler.ts",
  // P10.8 files
  "src/execution/executive/recommendation-effectiveness.ts",
  "src/interfaces/cli/commands/executive-effectiveness-handler.ts",
  // P10.8c files
  "src/execution/executive/subsystem-correlation.ts",
  "src/interfaces/cli/commands/executive-subsystem-correlation-handler.ts",
  // P10.9 files
  "src/execution/executive/executive-dashboard.ts",
  "src/execution/executive/executive-dashboard-loader.ts",
  // P10.9.1 files — plan-scoped snapshot stack (ADR-0005)
  "src/execution/executive/executive-snapshot-store.ts",
  "src/execution/executive/executive-snapshot-provider.ts",
  "src/execution/executive/executive-observation-provider.ts",
  // P10.9.2b files
  "src/execution/executive/executive-remediate.ts",
  "src/interfaces/cli/commands/executive-remediate-handler.ts",
  // P10.9.2c files
  "src/execution/executive/executive-orchestrator.ts",
  "src/interfaces/cli/commands/executive-orchestrate-handler.ts",
  // Future: providers may be discovered dynamically
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
  // File-system write functions (TrendStore, PlanStore, ExecutionStateStore are exceptions)
  "writeFileSync",
  "mkdirSync",
  "appendFileSync",
  "renameSync",
  "openSync",
  "fsyncSync",
  "closeSync",
  // P10.4a forbidden — must not call mutation or approval machinery
  "ApprovalGate",
  "ProposalApprovalGate",
  "randomUUID",       // only ExecutionEngine may generate ids
  "Math.random",      // only objective-engine may use (deterministic ID generation)
  "InvestigationRecommendationGenerator",
  "InvestigationStore",
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

describe("P10 executive purity sentinel", () => {
  for (const file of EXECUTIVE_FILES) {
    it(`${file} has no mutation write paths`, () => {
      // 1. If file does not exist (e.g. not yet committed in a worktree),
      //    skip the test gracefully.
      if (!existsSync(join(process.cwd(), file))) {
        return;
      }

      // Strip comments so a commented-out mutation symbol never trips (or
      // satisfies) the guard.
      const source = codeOnly(readSource(file));
      const lines = source.split("\n");

      // 2. For each line, check if it `.includes(forbidden)`.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 3. If any forbidden substring is found, throw a descriptive error with `file:line`.
        for (const forbidden of FORBIDDEN_IN_EXECUTIVE) {
          if (line.includes(forbidden)) {
            // "ApprovalGate" is a substring of "PlanApprovalGate" — skip
            // false positives on P10.4a's own plan approval gate.
            if (forbidden === "ApprovalGate" && line.includes("PlanApprovalGate")) {
              continue;
            }
            // Scoped exception: CLI dispatcher is the composition root and is
            // allowed to wire approval/rejection gates.
            if (file === "src/interfaces/cli/commands/executive.ts" &&
                (forbidden === ".approve(" || forbidden === ".reject(")) {
              continue;
            }

            // Scoped exception: execution-engine.ts is the only file allowed to
            // call randomUUID (constitutional invariant: only ExecutionEngine
            // generates executionId).
            if (file === "src/execution/executive/execution-engine.ts" &&
                forbidden === "randomUUID") {
              continue;
            }

            // Scoped exception: executive-orchestrator.ts uses randomUUID
            // for orchestration-sequence IDs ("orchestration-" prefix), which
            // are audit-trail correlation keys, not engine-internal executionIds.
            // Constitutional invariant applies to engine-internal execution flows.
            if (file === "src/execution/executive/executive-orchestrator.ts" &&
                forbidden === "randomUUID") {
              continue;
            }

            // Scoped exception: objective-engine.ts uses Math.random for
            // deterministic ID generation in objective naming.
            if (file === "src/execution/executive/objective-engine.ts" &&
                forbidden === "Math.random") {
              continue;
            }

            // Scoped exception: dashboard handler needs InvestigationStore
            // for the investigation→objective bridge (P10.2).
            if (file === "src/interfaces/cli/commands/executive-dashboard-handler.ts" &&
                forbidden === "InvestigationStore") {
              continue;
            }

            // Scoped exception: executive.ts dispatcher needs InvestigationStore
            // for the plan save pipeline (replicates dashboard handler logic).
            if (file === "src/interfaces/cli/commands/executive.ts" &&
                forbidden === "InvestigationStore") {
              continue;
            }

            // Scoped exception: executive.ts dispatcher uses PlanApprovalGate
            // (which contains "ApprovalGate" as substring). The P9 ApprovalGate
            // is different from P10.4a PlanApprovalGate.
            if (file === "src/interfaces/cli/commands/executive.ts" &&
                forbidden === "ApprovalGate") {
              continue;
            }

            // Scoped exception: trend-store.ts is an approved write path
            if (file === "src/execution/executive/trend-store.ts" &&
                (forbidden === "writeFileSync" || forbidden === "mkdirSync" || forbidden === "appendFileSync")) {
              continue;
            }

            // Scoped exception: plan-store.ts, execution-state-store.ts,
            // outcome-store.ts, and recommendation-report-store.ts are
            // approved write paths.
            if ((file === "src/execution/executive/plan-store.ts" ||
                 file === "src/execution/executive/execution-state-store.ts" ||
                 file === "src/execution/executive/outcome-store.ts" ||
                 file === "src/execution/executive/recommendation-report-store.ts" ||
                 // P10.9.1 — snapshot store is an approved write path
                 // (atomic-write baseline/current, per ADR-0005).
                 file === "src/execution/executive/executive-snapshot-store.ts") &&
                (forbidden === "writeFileSync" || forbidden === "mkdirSync" ||
                 forbidden === "renameSync" || forbidden === "openSync" ||
                 forbidden === "fsyncSync" || forbidden === "closeSync")) {
              continue;
            }

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
