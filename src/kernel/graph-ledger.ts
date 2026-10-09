// src/kernel/graph-ledger.ts
//
// R2.7/R2.13 — graph domain ledger writes. The transactional ledger is
// AUTHORITATIVE; the JSON files under `.alix/graphs/` are a compatibility
// projection. Every graph-file write site appends FIRST:
//   - the graph definition/status → entityType "graph" (events
//     `graph.created` / `graph.persisted`, full TaskGraph payload)
//   - each rerun attempt record → entityType "graphAttempt" (event
//     `graph.attempt_recorded`, payload { attempt }), entity per attempt so
//     replay/reconcile can count them exactly.
//
// A ledger append is the commit: its failure is counted, then THROWN — no
// JSON-only graph mutation can exist. Projection (JSON) failures are
// tolerated and counted. R0 B2 (graph rewrite without facts) is the defect
// this closes.

import type { TaskGraph } from "./task-graph.js";
import { currentEntityVersion, appendFact } from "../storage/runtime-ledger.js";

/**
 * Entity id for one rerun attempt — kept in ONE place because
 * `runtime_entities` keys by entity_id and the reconciler must decode it
 * back without ad-hoc string surgery.
 */
export function graphAttemptEntityId(graphId: string, attempt: number): string {
  return `${graphId}#attempt-${attempt}`;
}

/** Decode a `graphAttemptEntityId`; null when the id is not attempt-shaped. */
export function parseGraphAttemptEntityId(entityId: string): { graphId: string; attempt: number } | null {
  const idx = entityId.lastIndexOf("#attempt-");
  if (idx <= 0) return null;
  const attempt = Number(entityId.slice(idx + "#attempt-".length));
  if (!Number.isInteger(attempt)) return null;
  return { graphId: entityId.slice(0, idx), attempt };
}

export const GRAPH_LEDGER_EVENT_TYPES = [
  "graph.created",
  "graph.persisted",
  "graph.attempt_recorded",
] as const;

export type GraphLedgerStatus = {
  appends: number;
  failures: number;
  projectionFailures: number;
  lastError?: string;
  lastProjectionError?: string;
};

const statusByCwd = new Map<string, GraphLedgerStatus>();

function statusFor(cwd: string): GraphLedgerStatus {
  let s = statusByCwd.get(cwd);
  if (!s) {
    s = { appends: 0, failures: 0, projectionFailures: 0 };
    statusByCwd.set(cwd, s);
  }
  return s;
}

/** Observable authority health (R2: failures must never be silent). */
export function graphLedgerStatus(cwd: string): GraphLedgerStatus {
  const s = statusFor(cwd);
  return {
    ...s,
    ...(s.lastError !== undefined ? { lastError: s.lastError } : {}),
    ...(s.lastProjectionError !== undefined ? { lastProjectionError: s.lastProjectionError } : {}),
  };
}

/** Count a tolerated projection (JSON file) write failure. */
export function countGraphProjectionFailure(cwd: string, err: unknown): void {
  const s = statusFor(cwd);
  s.projectionFailures += 1;
  s.lastProjectionError = err instanceof Error ? err.message : String(err);
}

/** Reset counters (tests). */
export function resetGraphLedgerStatus(cwd: string): void {
  statusByCwd.delete(cwd);
}

/**
 * R2.13 append one graph snapshot — THE COMMIT (ledger is authoritative).
 * Must run BEFORE the graph-file write. Failure is counted, then THROWN:
 * no JSON-only graph mutation can exist.
 */
export function mirrorGraphToLedger(cwd: string, graph: TaskGraph): void {
  const s = statusFor(cwd);
  const expected = currentEntityVersion(cwd, s, graph.id);
  const eventType = expected === 0 ? "graph.created" : "graph.persisted";
  appendFact(cwd, s, {
    eventType,
    entityType: "graph",
    entityId: graph.id,
    payload: { graph },
    correlationId: graph.id,
    actor: { type: "system", id: "graph-store" },
    occurredAt: graph.updatedAt ?? new Date().toISOString(),
    expectedVersion: expected,
    errorLabel: "graph ledger",
  });
}

/**
 * Mirror one rerun attempt (idempotent: an attempt entity is written once;
 * re-mirroring an already-recorded attempt is a no-op).
 */
export function mirrorGraphAttemptToLedger(
  cwd: string,
  graphId: string,
  attempt: { attempt: number; nodeId?: string; status?: string; startedAt?: string; completedAt?: string; durationMs?: number; summary?: string; error?: string },
): void {
  const s = statusFor(cwd);
  const entityId = graphAttemptEntityId(graphId, attempt.attempt);
  if (currentEntityVersion(cwd, s, entityId) > 0) return; // already recorded — attempts are immutable
  appendFact(cwd, s, {
    eventType: "graph.attempt_recorded",
    entityType: "graphAttempt",
    entityId,
    payload: { attempt },
    correlationId: graphId,
    actor: { type: "system", id: "graph-store" },
    occurredAt: attempt.completedAt ?? attempt.startedAt ?? new Date().toISOString(),
    expectedVersion: 0,
    entityVersion: 1,
    errorLabel: "graph attempt ledger",
  });
}
