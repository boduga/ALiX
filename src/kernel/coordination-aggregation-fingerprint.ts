/**
 * coordination-aggregation-fingerprint.ts — Deterministic fingerprint for aggregate freshness.
 *
 * Hashes execution-relevant worker state only (not run.updatedAt) so attaching
 * aggregate metadata never makes the aggregate appear stale.
 */

import { createHash } from "node:crypto";
import type { CoordinationRun } from "./coordination-types.js";

export function computeAggregationSourceFingerprint(run: CoordinationRun): string {
  const relevant = {
    runId: run.id,
    rootGoal: run.rootGoal,
    status: run.status,
    workers: run.workers.map(w => ({
      id: w.id,
      status: w.status,
      attempt: w.attempt,
      resultRef: w.resultRef,
      error: w.error,
      failureKind: w.failureKind,
      blockReason: w.blockReason,
      completedAt: w.completedAt,
      updatedAt: w.updatedAt,
      failureProvenance: w.failureProvenance,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  const canonical = JSON.stringify(relevant, Object.keys(relevant).sort());
  return createHash("sha256").update(canonical).digest("hex");
}
