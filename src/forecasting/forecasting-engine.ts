// src/forecasting/forecasting-engine.ts
//
// P11.5 — ForecastingEngine orchestrator.
//
// Wires together StrategicPlanStore, ConfidenceModelStore,
// HealthForecastStore, and ScoreSnapshotProvider:
//   load plan + model + history -> pure function -> save -> return

import type { StrategicPlan } from "../planning/planning-types.js";
import { StrategicPlanStore } from "../planning/strategic-plan-store.js";
import { ConfidenceModelStore } from "../learning/confidence-model-store.js";
import { HealthForecastStore } from "./health-forecast-store.js";
import { buildHealthForecast } from "./build-health-forecast.js";
import type {
  HealthForecast,
  ForecastingEngineConfig,
  ForecastingObservationContext,
} from "./forecasting-types.js";
import { ForecasterError } from "./forecasting-types.js";
import type { ScoreSnapshotProvider } from "../learning/learning-types.js";
import type { CorrelationSubsystemId } from "../correlation/correlation-types.js";
import { DEFAULT_FORECASTING_CONFIG } from "./forecasting-config.js";

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ForecastingEngine {
  constructor(
    private readonly strategicPlanStore: StrategicPlanStore,
    private readonly confidenceModelStore: ConfidenceModelStore,
    private readonly healthForecastStore: HealthForecastStore,
    private readonly scoreSnapshotProvider: ScoreSnapshotProvider,
    private readonly config: ForecastingEngineConfig = DEFAULT_FORECASTING_CONFIG,
  ) {}

  /**
   * Run the full forecasting pipeline:
   *   1. Load the latest StrategicPlan.
   *   2. Load the latest UpdatedConfidenceModel (optional).
   *   3. Load score history and current scores.
   *   4. Compute HealthForecast via the pure function.
   *   5. Persist the forecast.
   *   6. Return the forecast.
   */
  async run(): Promise<HealthForecast> {
    const plan: StrategicPlan | null =
      await this.strategicPlanStore.loadLatest();

    if (plan === null) {
      throw new ForecasterError(
        "No strategic plan available. Run 'alix executive strategic-plan' first.",
      );
    }

    const confidenceModel = await this.confidenceModelStore.loadLatest();

    const currentScores =
      await this.scoreSnapshotProvider.loadCurrentScores();

    // Build score history from past windows
    const generatedAt = new Date().toISOString();
    const scoreHistory = new Map<CorrelationSubsystemId, number[]>();

    for (let i = this.config.trendWindow - 1; i >= 0; i--) {
      const timestamp =
        new Date(
          new Date(generatedAt).getTime() - i * this.config.windowDurationMs,
        ).toISOString();
      const snapshot = await this.scoreSnapshotProvider.loadScoresAt(timestamp);

      for (const [subsystem, score] of snapshot) {
        const existing = scoreHistory.get(subsystem) ?? [];
        existing.push(score);
        scoreHistory.set(subsystem, existing);
      }
    }

    const context: ForecastingObservationContext = {
      generatedAt,
    };

    const forecast = buildHealthForecast(
      plan,
      confidenceModel,
      scoreHistory,
      currentScores,
      context,
      this.config,
    );

    await this.healthForecastStore.save(forecast);

    return forecast;
  }

  async loadLatestForecast(): Promise<HealthForecast | null> {
    return this.healthForecastStore.loadLatest();
  }
}
