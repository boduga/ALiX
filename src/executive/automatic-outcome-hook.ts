/**
 * P10.5c + P10.9.1 — Automatic Outcome Evaluation Hook.
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
 * P10.9.1 — Read sites + auto-current snapshot.
 *   - Baseline + current resolution goes through the plan-scoped snapshot
 *     stack (ExecutiveSnapshotStore.loadBaseline/loadCurrent →
 *     ExecutiveTrendStore.loadById via trendSnapshotId). Same symmetric
 *     path as executive-evaluate-handler.
 *   - Eager auto-capture of current snapshot for plans in terminal status
 *     when no current snapshot exists yet (invariant C from p10-9-1 plan).
 *   - Fail-loud on missing baseline (warning includes the literal
 *     "baseline not captured for planId=<id>") — surface structural data
 *     gaps instead of silently returning insufficient_data downstream.
 *
 * @module
 */

import { evaluatePlanOutcome } from "./outcome-evaluator.js";
import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "./executive-plan-types.js";
import { OutcomeReportStore, OutcomeReportIntegrityError } from "./outcome-store.js";
import { ExecutiveTrendStore } from "./trend-store.js";
import type { ExecutiveTrendSnapshot } from "./trend-store.js";
import { ExecutiveSnapshotStore } from "./executive-snapshot-store.js";
import { createDefaultSnapshotProvider } from "./executive-snapshot-provider.js";
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
    /** P10.9.1-T2 — optional executive directory for the snapshot stack.
     *  When provided, the hook uses the plan-scoped snapshot resolution
     *  path. When omitted (legacy wiring), falls back to the time-window
     *  trend-store lookup so existing callers do not break. */
    private readonly execDir?: string,
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

      // 3. Resolve baseline + current trend snapshots via the snapshot stack
      //    (P10.9.1-T2 — symmetric resolution). When execDir is provided,
      //    use the plan-scoped path; otherwise fall back to the legacy
      //    time-window lookup for backward compatibility.
      let baseline: ExecutiveTrendSnapshot | null;
      let current: ExecutiveTrendSnapshot | null;
      if (this.execDir) {
        const resolved = await this.resolveFromSnapshotStack(plan.id, state);
        baseline = resolved.baseline;
        current = resolved.current;
        if (resolved.baselineMissing) {
          console.warn(
            `[automatic-outcome-hook] baseline not captured for planId=${plan.id} — plan was never executed by ExecutionEngine (no engine baseline snapshot found on disk). Evaluator will report insufficient_data.`,
          );
        }
      } else {
        baseline = await this.trendStore.findBaseline(plan.generatedAt);
        current = await this.trendStore.loadLatest();
      }

      // 4. Evaluate the plan using the pure evaluator
      const evaluated = evaluatePlanOutcome(plan, state, baseline, current);

      // 5. Build a new report object with deterministic timestamp —
      //    never mutate the evaluator's return value
      const report: ExecutiveOutcomeEvaluationReport = {
        ...evaluated,
        generatedAt: terminalTimestamp,
      };

      // 6. Persist
      this.outcomeStore.save(report);
    } catch (e) {
      // Best-effort: never block plan completion
      console.warn(
        `[automatic-outcome-hook] Auto-evaluation failed for plan ${plan.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // P10.9.1-T2 — plan-scoped snapshot resolution (invariant A from p10-9-1)
  //
  // Symmetric: baseline + current both go through ExecutiveSnapshotStore →
  // ExecutivePlanSnapshot.rawSubsystemState.trendSnapshotId →
  // ExecutiveTrendStore.loadById().
  // -------------------------------------------------------------------------

  private async resolveFromSnapshotStack(
    planId: string,
    state: PlanExecutionState,
  ): Promise<{
    baseline: ExecutiveTrendSnapshot | null;
    current: ExecutiveTrendSnapshot | null;
    baselineMissing: boolean;
  }> {
    const execDir = this.execDir!;
    const snapshotStore = new ExecutiveSnapshotStore(join(execDir, "snapshots"));
    const provider = createDefaultSnapshotProvider(execDir);

    let baselineSnapshot = null;
    let currentSnapshot = null;
    try {
      baselineSnapshot = await snapshotStore.loadBaseline(planId);
    } catch (e) {
      console.warn(
        `[automatic-outcome-hook] Failed to load baseline snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    try {
      currentSnapshot = await snapshotStore.loadCurrent(planId);
    } catch (e) {
      console.warn(
        `[automatic-outcome-hook] Failed to load current snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Eager auto-capture of current snapshot (invariant C). If the plan is
    // terminal and no current snapshot exists yet, capture + save before
    // the evaluator runs. Idempotent — subsequent calls reuse the captured
    // current snapshot.
    if (
      (state.status === "completed" || state.status === "failed") &&
      !currentSnapshot
    ) {
      try {
        const captured = await provider.captureCurrent(planId);
        await snapshotStore.saveCurrent(captured);
        currentSnapshot = captured;
      } catch (e) {
        console.warn(
          `[automatic-outcome-hook] Failed to auto-capture current snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    let baselineTrend: ExecutiveTrendSnapshot | null = null;
    let currentTrend: ExecutiveTrendSnapshot | null = null;

    if (baselineSnapshot?.rawSubsystemState.trendSnapshotId) {
      try {
        baselineTrend = await this.trendStore.loadById(
          baselineSnapshot.rawSubsystemState.trendSnapshotId,
        );
      } catch (e) {
        console.warn(
          `[automatic-outcome-hook] Failed to resolve baseline trend snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (currentSnapshot?.rawSubsystemState.trendSnapshotId) {
      try {
        currentTrend = await this.trendStore.loadById(
          currentSnapshot.rawSubsystemState.trendSnapshotId,
        );
      } catch (e) {
        console.warn(
          `[automatic-outcome-hook] Failed to resolve current trend snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return {
      baseline: baselineTrend,
      current: currentTrend,
      baselineMissing: baselineSnapshot === null,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a default AutomaticOutcomeEvaluator from a base directory.
 * Uses the standard executive directory layout (.alix/executive/{outcomes,trends,snapshots}).
 *
 * P10.9.1-T2 — the factory now threads `executiveDir` through to the
 * evaluator so the hook can use the plan-scoped snapshot stack instead
 * of the legacy time-window trend lookup. This is the only signature
 * change; existing call sites use the same `createAutomaticOutcomeEvaluator(execDir)`
 * pattern from P10.4c.
 */
export function createAutomaticOutcomeEvaluator(
  executiveDir: string,
): AutomaticOutcomeEvaluator {
  const outcomesDir = join(executiveDir, "outcomes");
  return new AutomaticOutcomeEvaluator(
    new OutcomeReportStore(outcomesDir),
    new ExecutiveTrendStore(executiveDir),
    executiveDir,
  );
}