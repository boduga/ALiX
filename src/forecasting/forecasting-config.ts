// src/forecasting/forecasting-config.ts
//
// P11.5 — Default ForecastingEngine configuration constants.

import type { ForecastingEngineConfig } from "./forecasting-types.js";

export const DEFAULT_FORECASTING_CONFIG: ForecastingEngineConfig = {
  forecastWindows: 3,
  trendWindow: 5,
  dampeningFactor: 0.3,
  windowDurationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  highConfidenceThreshold: 0.7,
  mediumConfidenceThreshold: 0.4,
};
