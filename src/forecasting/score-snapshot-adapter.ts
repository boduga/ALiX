// src/forecasting/score-snapshot-adapter.ts
//
// P11.5 — V1 ScoreSnapshotProvider adapter.
//
// Wraps baseline provider data or returns empty maps (stub).
// In v1, falls back to plan objective.currentScore when no
// historical data is available.

import type { CorrelationSubsystemId } from "../correlation/correlation-types.js";
import type { ScoreSnapshotProvider } from "../learning/learning-types.js";

/**
 * V1 stub adapter implementing ScoreSnapshotProvider.
 *
 * Returns empty maps — the forecasting engine handles missing data
 * by falling back to objective.currentScore (for baseline) and
 * skipping the subsystem (for current score).
 *
 * Replace with a real P10.10 baseline provider adapter when
 * historical score storage is available.
 */
export class V1ScoreSnapshotAdapter implements ScoreSnapshotProvider {
  async loadScoresAt(
    _timestamp: string,
  ): Promise<Map<CorrelationSubsystemId, number>> {
    return new Map();
  }

  async loadCurrentScores(): Promise<Map<CorrelationSubsystemId, number>> {
    return new Map();
  }
}
