// src/reasoning/reasoning-config.ts
//
// P11.2 — Default ReasoningEngine configuration.

import type { ReasoningEngineConfig } from "./reasoning-types.js";

export const DEFAULT_REASONING_CONFIG: ReasoningEngineConfig = {
  minCauseConfidence: 0.40,
  maxCausesPerSubsystem: 3,
  degradationThreshold: 40,
};
