// src/kernel/coordination-ledger-reconcile.ts
//
// R2 step 4 — compare the coordination JSON store against the transactional
// ledger. Dual-write phase: JSON is authoritative; this reports drift so it
// is observable instead of latent. Counts unknown event types and reports
// read truncation (R2 exit conditions).
//
// Issue kinds:
//   missing_in_ledger    — run JSON exists, zero ledger events (legacy run or
//                          a dual-write failure window)
//   status_mismatch      — JSON run.status differs from last snapshot event
//   worker_status_mismatch — a worker's JSON status/attempt differs from the
//                          last snapshot event
//   plan_revision_mismatch — JSON planRevision differs from last snapshot
//   version_behind       — last event entityVersion ≠ event count (lost events)
//   orphan_in_ledger     — ledger entity with no run JSON and no delete event
//   ledger_write_failed  — store reported dual-write failures in-process
//                          (see CoordinationStore.ledgerStatus)

import { CoordinationStore, COORDINATION_LEDGER_EVENT_TYPES } from "./coordination-store.js";
import type { CoordinationRun } from "./coordination-types.js";
import { getSharedLedger } from "../storage/runtime-ledger.js";

export type ReconcileIssueKind =
  | "missing_in_ledger"
  | "status_mismatch"
  | "worker_status_mismatch"
  | "plan_revision_mismatch"
  | "version_behind"
  | "orphan_in_ledger"
  | "ledger_write_failed";

export interface ReconcileIssue {
  runId: string;
  kind: ReconcileIssueKind;
  detail: string;
}

export interface ReconcileReport {
  scannedRuns: number;
  ledgerEventsRead: number;
  issues: ReconcileIssue[];
  /** eventType → count for types outside this domain's known vocabulary. */
  unknownEventTypes: Record<string, number>;
  /** True when the bounded drain hit its page cap — reads are incomplete. */
  truncated: boolean;
  ok: boolean;
}

const KNOWN_TYPES = new Set<string>(COORDINATION_LEDGER_EVENT_TYPES);

interface LedgerEventRow {
  eventType: string;
  entityId: string;
  entityVersion: number;
  payload: unknown;
  ledgerSeq: number;
}

/**
 * Drain ledger events for one domain with a bounded cursor walk so a huge
 * ledger cannot stall the caller; `truncated` becomes true if the cap is hit.
 */
function drainLedgerEvents(cwd: string, maxPages = 50, pageSize = 2000): { events: LedgerEventRow[]; truncated: boolean } {
  const ledger = getSharedLedger(cwd);
  const events: LedgerEventRow[] = [];
  let cursor = 0;
  for (let page = 0; page < maxPages; page++) {
    const rows = ledger.readEvents({ sinceSeq: cursor, limit: pageSize });
    for (const r of rows) {
      events.push({
        eventType: r.eventType,
        entityId: r.entityId,
        entityVersion: r.entityVersion,
        payload: r.payload,
        ledgerSeq: r.ledgerSeq,
      });
      cursor = r.ledgerSeq;
    }
    if (rows.length < pageSize) return { events, truncated: false };
  }
  return { events, truncated: true };
}

interface SnapshotPayload {
  status?: string;
  planRevision?: number;
  workerStatuses?: Record<string, { status?: string; attempt?: number }>;
}

/**
 * Compare every coordination run JSON against the ledger. Read-only: never
 * mutates either side.
 */
export async function reconcileCoordinationLedger(cwd: string): Promise<ReconcileReport> {
  const issues: ReconcileIssue[] = [];
  const unknownEventTypes: Record<string, number> = {};

  // JSON side
  const store = new CoordinationStore(cwd);
  const runs: CoordinationRun[] = await store.list();

  // Ledger side (bounded drain)
  const { events, truncated } = drainLedgerEvents(cwd);

  const byEntity = new Map<string, LedgerEventRow[]>();
  for (const e of events) {
    if (!KNOWN_TYPES.has(e.eventType)) {
      unknownEventTypes[e.eventType] = (unknownEventTypes[e.eventType] ?? 0) + 1;
    }
    const list = byEntity.get(e.entityId) ?? [];
    list.push(e);
    byEntity.set(e.entityId, list);
  }

  const jsonRunIds = new Set<string>();
  for (const run of runs) {
    jsonRunIds.add(run.id);
    const evts = byEntity.get(run.id);
    if (!evts || evts.length === 0) {
      issues.push({
        runId: run.id,
        kind: "missing_in_ledger",
        detail: "run JSON exists with zero ledger events (legacy run or dual-write failure)",
      });
      continue;
    }
    const last = evts[evts.length - 1];
    if (last.entityVersion !== evts.length) {
      issues.push({
        runId: run.id,
        kind: "version_behind",
        detail: `last entityVersion ${last.entityVersion} != event count ${evts.length}`,
      });
    }
    const snap = (last.payload ?? {}) as SnapshotPayload;
    if (last.eventType !== "coordination.run.deleted") {
      if (snap.status !== undefined && snap.status !== run.status) {
        issues.push({
          runId: run.id,
          kind: "status_mismatch",
          detail: `json=${run.status} ledger=${snap.status}`,
        });
      }
      if (typeof snap.planRevision === "number" && (run.planRevision ?? 0) !== snap.planRevision) {
        issues.push({
          runId: run.id,
          kind: "plan_revision_mismatch",
          detail: `json=${run.planRevision ?? 0} ledger=${snap.planRevision}`,
        });
      }
      if (snap.workerStatuses) {
        for (const worker of run.workers) {
          const mirrored = snap.workerStatuses[worker.id];
          if (!mirrored) {
            issues.push({
              runId: run.id,
              kind: "worker_status_mismatch",
              detail: `worker ${worker.id} absent from last ledger snapshot`,
            });
            continue;
          }
          if (mirrored.status !== worker.status || (mirrored.attempt ?? 0) !== (worker.attempt ?? 0)) {
            issues.push({
              runId: run.id,
              kind: "worker_status_mismatch",
              detail: `worker ${worker.id}: json={${worker.status},attempt=${worker.attempt ?? 0}} ledger={${mirrored.status},attempt=${mirrored.attempt ?? 0}}`,
            });
          }
        }
      }
    }
  }

  // Orphans: ledger entities with no JSON run and no terminal delete event.
  for (const [entityId, evts] of byEntity) {
    if (jsonRunIds.has(entityId)) continue;
    const last = evts[evts.length - 1];
    if (last.eventType === "coordination.run.deleted") continue;
    issues.push({
      runId: entityId,
      kind: "orphan_in_ledger",
      detail: `ledger has ${evts.length} event(s) but no run JSON (deleted outside the store or file lost)`,
    });
  }

  const storeStatus = store.ledgerStatus();
  if (storeStatus.failures > 0) {
    issues.push({
      runId: "*",
      kind: "ledger_write_failed",
      detail: `in-process dual-write failures=${storeStatus.failures} lastError=${storeStatus.lastError ?? "unknown"}`,
    });
  }

  issues.sort((a, b) => a.runId.localeCompare(b.runId) || a.kind.localeCompare(b.kind));
  return {
    scannedRuns: runs.length,
    ledgerEventsRead: events.length,
    issues,
    unknownEventTypes,
    truncated,
    ok: issues.length === 0 && !truncated,
  };
}
