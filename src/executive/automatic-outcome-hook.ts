/**
 * P10.5c — Automatic Outcome Evaluation Hook.
 *
 * Bridges ExecutionEngine to OutcomeReportStore. When a plan reaches
 * a terminal status (completed or failed), the engine calls this hook
 * which evaluates the plan via the pure evaluator and persists the
 * report. Idempotent: keyed by (planId, terminalTimestamp).
 *
 * Best-effort: never throws upward. Integrity errors from
 * OutcomeReportStore.load() are caught and the existing artifact is
 * preserved (no overwrite).
 *
 * @module
 */

import { evaluatePlanOutcome } from "./outcome-evaluator.js";
import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "./executive-plan-types.js";
import { OutcomeReportStore, OutcomeReportIntegrityError } from "./outcome-store.js";
import { ExecutiveTrendStore } from "./trend-store.js";
import { buildOutcomeReportId } from "./outcome-report-id.js";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface OutcomeEvaluationHook {
  run(
    plan: PersistedExecutionPlan,
    state: PlanExecutionState,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AutomaticOutcomeEvaluator implements OutcomeEvaluationHook {
  constructor(
    private readonly outcomeStore: OutcomeReportStore,
    private readonly trendStore: ExecutiveTrendStore,
  ) {}

  async run(
    plan: PersistedExecutionPlan,
    state: PlanExecutionState,
  ): Promise<void> {
    try {
      // 1. Determine terminalTimestamp (completedAt wins over failedAt)
      const terminalTimestamp =
        state.timestamps.completedAt ?? state.timestamps.failedAt;

      if (!terminalTimestamp) {
        console.warn(
          `[automatic-outcome-hook] Plan ${plan.id} reached status "${state.status}" but has no terminal timestamp — skipping auto-evaluation`,
        );
        return;
      }

      // 2. Idempotency check — preserve existing audit artifacts
      const reportId = buildOutcomeReportId(plan.id, terminalTimestamp);
      let existing: ExecutiveOutcomeEvaluationReport | null = null;
      try {
        existing = this.outcomeStore.load(reportId);
      } catch (e) {
        if (e instanceof OutcomeReportIntegrityError) {
          // Forensic preservation: never overwrite a corrupted audit artifact
          console.warn(
            `[automatic-outcome-hook] Outcome report ${reportId} failed integrity verification — preserving existing artifact: ${e.message}`,
          );
          return;
        }
        // Unexpected runtime error: warn but don't block the plan
        console.warn(
          `[automatic-outcome-hook] Unexpected load error for ${reportId} — skipping: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }

      if (existing) {
        // Already evaluated for this terminal transition — idempotent no-op
        return;
      }

      // 3. Evaluate the plan using the pure evaluator
      const baseline = await this.trendStore.findBaseline(plan.generatedAt);
      const current = await this.trendStore.loadLatest();
      const evaluated = evaluatePlanOutcome(plan, state, baseline, current);

      // 4. Build a new report object with deterministic timestamp —
      //    never mutate the evaluator's return value
      const report: ExecutiveOutcomeEvaluationReport = {
        ...evaluated,
        generatedAt: terminalTimestamp,
      };

      // 5. Persist
      this.outcomeStore.save(report);
    } catch (e) {
      // Best-effort: never block plan completion
      console.warn(
        `[automatic-outcome-hook] Auto-evaluation failed for plan ${plan.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a default AutomaticOutcomeEvaluator from a base directory.
 * Uses the standard executive directory layout (.alix/executive/{outcomes,trends}).
 */
export function createAutomaticOutcomeEvaluator(
  executiveDir: string,
): AutomaticOutcomeEvaluator {
  const outcomesDir = join(executiveDir, "outcomes");
  const trendsDir = join(executiveDir, "trends");
  return new AutomaticOutcomeEvaluator(
    new OutcomeReportStore(outcomesDir),
    new ExecutiveTrendStore(executiveDir),
  );
}
