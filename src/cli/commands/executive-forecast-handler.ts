/**
 * P11.5 — Executive forecast CLI handler.
 *
 * Handles `alix executive forecast [--json] [--latest]`.
 * Runs the ForecastingEngine to produce a HealthForecast and displays
 * a summary or full JSON output. The `--latest` flag loads the last saved
 * forecast without re-running.
 *
 * @module
 */

import { join } from "node:path";
import { StrategicPlanStore } from "../../planning/strategic-plan-store.js";
import { ConfidenceModelStore } from "../../learning/confidence-model-store.js";
import { HealthForecastStore } from "../../forecasting/health-forecast-store.js";
import { ForecastingEngine } from "../../forecasting/forecasting-engine.js";
import { DEFAULT_FORECASTING_CONFIG } from "../../forecasting/forecasting-config.js";
import { V1ScoreSnapshotAdapter } from "../../forecasting/score-snapshot-adapter.js";
import type { HealthForecast } from "../../forecasting/forecasting-types.js";
import { ForecasterError } from "../../forecasting/forecasting-types.js";

export async function handleForecastCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const planningDir = join(cwd, ".alix", "planning");
  const learningDir = join(cwd, ".alix", "learning");
  const forecastingDir = join(cwd, ".alix", "forecasting");
  const isJson = args.includes("--json");
  const isLatest = args.includes("--latest");

  try {
    if (isLatest) {
      const store = new HealthForecastStore(forecastingDir);
      const forecast = await store.loadLatest();
      if (!forecast) {
        if (isJson) {
          console.log(JSON.stringify({ error: "No saved health forecast found." }));
        } else {
          console.log("No saved health forecast found.");
        }
        return;
      }
      printSummary(forecast, isJson);
      return;
    }

    const strategicPlanStore = new StrategicPlanStore(planningDir);
    const confidenceModelStore = new ConfidenceModelStore(learningDir);
    const healthForecastStore = new HealthForecastStore(forecastingDir);
    const scoreSnapshotProvider = new V1ScoreSnapshotAdapter();

    const engine = new ForecastingEngine(
      strategicPlanStore,
      confidenceModelStore,
      healthForecastStore,
      scoreSnapshotProvider,
      DEFAULT_FORECASTING_CONFIG,
    );
    const forecast = await engine.run();
    printSummary(forecast, isJson);
  } catch (err: unknown) {
    if (err instanceof ForecasterError) {
      console.error(`Forecasting engine error: ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`Forecasting error: ${err.message}`);
    } else {
      console.error("Unknown forecasting error");
    }
    process.exit(1);
  }
}

function printSummary(forecast: HealthForecast, isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(forecast, null, 2));
    return;
  }

  console.log(`Health Forecast`);
  console.log(`Forecast: ${forecast.forecastId}`);
  console.log(`Source plan: ${forecast.sourcePlanId}`);
  console.log(`Source confidence model: ${forecast.sourceConfidenceModelId ?? "(none)"}`);
  console.log(`Windows: ${forecast.forecastWindows} forward`);

  if (forecast.projections.length > 0) {
    console.log();

    // Dynamic header — W1..W{forecastWindows}
    const windowHeaders: string[] = [];
    for (let w = 0; w < forecast.forecastWindows; w++) {
      windowHeaders.push(`W${w + 1}`.padEnd(8));
    }

    console.log(
      `${"Subsystem".padEnd(16)} ${"Current".padEnd(8)} ${windowHeaders.join("")} ${"Confidence".padEnd(12)}`,
    );
    console.log(
      `${"".padEnd(16, "-")} ${"".padEnd(8, "-")} ${windowHeaders.map(() => "".padEnd(8, "-")).join("")} ${"".padEnd(12, "-")}`,
    );

    for (const proj of forecast.projections) {
      const windowValues = proj.projectedScores.map((s) =>
        String(Math.round(s)).padEnd(8),
      );
      const confLabel =
        proj.forecastConfidence >= 0.7
          ? "high"
          : proj.forecastConfidence >= 0.4
            ? "med"
            : "low";
      const confStr =
        `${confLabel} (${proj.forecastConfidence})`.padEnd(12);

      console.log(
        `${proj.targetSubsystem.padEnd(16)} ` +
        `${String(proj.currentScore).padEnd(8)} ` +
        `${windowValues.join("")}` +
        `${confStr}`,
      );
    }
  }

  if (forecast.meta.subsystemsForecast === 0) {
    console.log(`\nNote: No subsystems to forecast. Run 'alix executive strategic-plan' to produce a plan first.`);
  }
}
