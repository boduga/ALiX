/**
 * coordination-aggregation-fingerprint.ts — Deterministic fingerprint for aggregate freshness.
 *
 * Hashes execution-relevant worker state only (not run.updatedAt) so attaching
 * aggregate metadata never makes the aggregate appear stale.
 */

import { createHash } from "node:crypto";
import type { CoordinationRun } from "./coordination-types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

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
  const canonical = JSON.stringify(canonicalize(relevant));
  return createHash("sha256").update(canonical).digest("hex");
}
