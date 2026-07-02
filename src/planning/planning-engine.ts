// src/planning/planning-engine.ts
//
// P11.3 — PlanningEngine orchestrator.
//
// Wires together RootCauseStore (P11.2), the pure buildStrategicPlan function,
// and StrategicPlanStore (P11.3) into a thin orchestrator:
//   load -> pure function -> save -> return

import type { RootCauseAnalysis } from "../reasoning/reasoning-types.js";
import { RootCauseStore } from "../reasoning/root-cause-store.js";
import { StrategicPlanStore } from "./strategic-plan-store.js";
import { buildStrategicPlan } from "./build-strategic-plan.js";
import type { StrategicPlan, PlanningEngineConfig } from "./planning-types.js";
import { PlanningEngineError } from "./planning-types.js";
import { DEFAULT_PLANNING_CONFIG } from "./planning-config.js";

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class PlanningEngine {
  constructor(
    private readonly rootCauseStore: RootCauseStore,
    private readonly strategicPlanStore: StrategicPlanStore,
    private readonly config: PlanningEngineConfig = DEFAULT_PLANNING_CONFIG,
  ) {}

  /**
   * Run the full planning pipeline:
   *   1. Load the latest RootCauseAnalysis from the store.
   *   2. Transform it into a StrategicPlan via the pure buildStrategicPlan
   *      function.
   *   3. Persist the plan.
   *   4. Return the plan.
   *
   * Throws PlanningEngineError when no root cause analysis is available.
   * No separate error handling for stale/insufficient_analysis status —
   * buildStrategicPlan returns a valid plan artifact with empty objectives
   * and the correct status for those cases.
   */
  async run(): Promise<StrategicPlan> {
    const analysis: RootCauseAnalysis | null =
      await this.rootCauseStore.loadLatest();

    if (analysis === null) {
      throw new PlanningEngineError(
        "No root cause analysis available. Run 'alix executive reason' first.",
      );
    }

    const plan: StrategicPlan = buildStrategicPlan(analysis, this.config);

    await this.strategicPlanStore.save(plan);

    return plan;
  }

  /**
   * Load the most recently persisted StrategicPlan from the store.
   * Returns null when no plan has been saved yet.
   */
  async loadLatest(): Promise<StrategicPlan | null> {
    return this.strategicPlanStore.loadLatest();
  }
}
