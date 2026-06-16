/**
 * collaboration-freshness.ts — Finding lifecycle status and recency scoring.
 *
 * Stale attempts, dependencies, and artifact references are detected
 * using clock-injected time. The system never calls Date.now() directly.
 */

import type { SharedFinding } from "./collaboration-types.js";
import type { CoordinationRun } from "./coordination-types.js";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export type FindingStatus =
  | "active"
  | "superseded"
  | "invalidated"
  | "stale_attempt"
  | "stale_dependency"
  | "stale_artifact";

/**
 * Compute the lifecycle status of a finding.
 * Findings from prior worker attempts are stale_attempt.
 * Superseded and invalidated are determined by the finding's own fields.
 */
export function computeFindingStatus(
  finding: SharedFinding,
  currentAttempt: number,
): FindingStatus {
  if (finding.invalidatedAt) return "invalidated";
  if (finding.supersededBy) return "superseded";
  if (finding.workerAttempt !== undefined && finding.workerAttempt < currentAttempt) return "stale_attempt";
  return "active";
}

/**
 * Compute a recency score from 1–8 based on age.
 * Uses clock-injected time for determinism in tests.
 */
export function computeRecencyScore(createdAt: string, clock: Clock): number {
  const ageMs = clock.now().getTime() - new Date(createdAt).getTime();
  const ageMin = ageMs / 60_000;
  if (ageMin < 5) return 8;
  if (ageMin < 30) return 6;
  if (ageMin < 120) return 4;
  if (ageMin < 1440) return 2;
  return 1;
}
