// src/kernel/graph-ledger.ts
//
// R2.7 — graph domain dual-write to the transactional ledger (strangler).
// The JSON files under `.alix/graphs/` stay authoritative in this phase;
// every graph-file write site mirrors:
//   - the graph definition/status → entityType "graph" (events
//     `graph.created` / `graph.persisted`, full TaskGraph payload)
//   - each rerun attempt record → entityType "graphAttempt" (event
//     `graph.attempt_recorded`, payload { attempt }), entity per attempt so
//     replay/reconcile can count them exactly.
//
// Mirror failures are COUNTED, never thrown — reconciliation reports drift.
// R0 B2 (graph rewrite without facts) is the defect this closes.

import { randomUUID } from "node:crypto";
import type { TaskGraph } from "./task-graph.js";
import { getSharedLedger } from "../storage/runtime-ledger.js";

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
  try {
    const ledger = getSharedLedger(cwd);
    const expected = ledger.entityVersion(graph.id);
    const eventType = expected === 0 ? "graph.created" : "graph.persisted";
    const res = ledger.append({
      event: {
        eventId: randomUUID(),
        eventType,
        schemaVersion: 1,
        entityType: "graph",
        entityId: graph.id,
        entityVersion: expected + 1,
        correlationId: graph.id,
        actor: { type: "system", id: "graph-store" },
        occurredAt: graph.updatedAt ?? new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        payload: { graph },
      },
      expectedVersion: expected,
    });
    if (res.ok) {
      s.appends += 1;
      return;
    }
    s.failures += 1;
    s.lastError = `${res.reason}: ${res.detail}`;
    throw new Error(`graph ledger append failed (${res.reason}): ${res.detail}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("graph ledger append failed")) throw err;
    s.failures += 1;
    s.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
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
  try {
    const ledger = getSharedLedger(cwd);
    const entityId = `${graphId}#attempt-${attempt.attempt}`;
    const expected = ledger.entityVersion(entityId);
    if (expected > 0) return; // already recorded — attempts are immutable
    const res = ledger.append({
      event: {
        eventId: randomUUID(),
        eventType: "graph.attempt_recorded",
        schemaVersion: 1,
        entityType: "graphAttempt",
        entityId,
        entityVersion: 1,
        correlationId: graphId,
        actor: { type: "system", id: "graph-store" },
        occurredAt: attempt.completedAt ?? attempt.startedAt ?? new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        payload: { attempt },
      },
      expectedVersion: 0,
    });
    if (res.ok) {
      s.appends += 1;
      return;
    }
    s.failures += 1;
    s.lastError = `${res.reason}: ${res.detail}`;
    throw new Error(`graph attempt ledger append failed (${res.reason}): ${res.detail}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("graph attempt ledger append failed")) throw err;
    s.failures += 1;
    s.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}
