// src/planning/planning-config.ts
//
// P11.3 — Default PlanningEngine configuration.

import type { PlanningEngineConfig } from "./planning-types.js";

export const DEFAULT_PLANNING_CONFIG: PlanningEngineConfig = {
  maxObjectives: 8,
  minUrgencyScore: 15,
};
