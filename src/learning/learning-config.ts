// src/learning/learning-config.ts
//
// P11.4 — Default LearningEngine configuration constants.

import type { LearningEngineConfig } from "./learning-types.js";

export const DEFAULT_LEARNING_CONFIG: LearningEngineConfig = {
  maxPositiveAdjustment: 0.05,
  maxNegativeAdjustment: 0.05,
  minConfidence: 0.05,
  maxConfidence: 0.95,
  minImprovementDelta: 5,
  evaluationWindowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};
