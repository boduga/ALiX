// src/correlation/correlation-config.ts

import type { CorrelationEngineConfig, CorrelationSubsystemId } from "./correlation-types.js";

export const PRODUCTION_SUBSYSTEMS: CorrelationSubsystemId[] = [
  "memory", "workflow", "skills", "agents",
  "tools", "security", "governance", "adaptation",
];

export const DEFAULT_CORRELATION_CONFIG: CorrelationEngineConfig = {
  windowSize: 12,
  minSamples: 6,
  maxTemporalLag: 3,
  degradationDeltaThreshold: -5,
  minEdgeConfidence: 0.35,
  staleAfterWindows: 3,
  canonicalSubsystems: [...PRODUCTION_SUBSYSTEMS],
  excludedSubsystems: ["demo"],
};
