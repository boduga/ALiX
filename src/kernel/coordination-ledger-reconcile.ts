// src/kernel/coordination-ledger-reconcile.ts
//
// R2.3 — compare the coordination JSON compatibility projection against the
// authoritative transactional ledger. Read-only: never mutates either side.
// Counts unknown event types and reports read truncation (R2 exit conditions).
//
// The ledger is truth. This reports projection drift:
//   missing_in_ledger      — JSON projection exists, zero ledger facts
//                            (legacy pre-ledger run)
//   projection_missing     — live ledger entity with no JSON file
//                            (projection write failed or file lost)
//   projection_stale       — ledger says deleted, JSON file still present
//   status_mismatch        — JSON status differs from the ledger run
//   worker_status_mismatch — a worker's JSON status/attempt differs from
//                            the ledger run
//   plan_revision_mismatch — JSON planRevision differs from the ledger run
//   version_behind         — last event entityVersion ≠ event count
//   ledger_payload_invalid — live ledger event without a run payload
//                            (store.load would throw the same error)

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { COORDINATION_LEDGER_EVENT_TYPES } from "./coordination-store.js";
import type { CoordinationRun } from "./coordination-types.js";
import { getSharedLedger } from "../storage/runtime-ledger.js";

export type ReconcileIssueKind =
  | "missing_in_ledger"
  | "projection_missing"
  | "projection_stale"
  | "status_mismatch"
  | "worker_status_mismatch"
  | "plan_revision_mismatch"
  | "version_behind"
  | "ledger_payload_invalid";

export interface ReconcileIssue {
  runId: string;
  kind: ReconcileIssueKind;
  detail: string;
}

export interface ReconcileReport {
  /** JSON projection files scanned. */
  scannedRuns: number;
  /** Live (non-deleted) ledger entities. */
  ledgerEntities: number;
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
 * Drain ledger events with a bounded cursor walk so a huge ledger cannot
 * stall the caller; `truncated` becomes true if the cap is hit.
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

/** Read the JSON projection files directly — never through the authority read. */
async function readProjectionRuns(cwd: string): Promise<CoordinationRun[]> {
  const dir = join(cwd, ".alix", "coordination");
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const runs: CoordinationRun[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      runs.push(JSON.parse(raw) as CoordinationRun);
    } catch {
      // corrupt projection file — reported by kind below as missing/invalid
      // via its absence from this list; keep scanning.
    }
  }
  return runs;
}

/**
 * Compare every JSON projection against the authoritative ledger.
 */
export async function reconcileCoordinationLedger(cwd: string): Promise<ReconcileReport> {
  const issues: ReconcileIssue[] = [];
  const unknownEventTypes: Record<string, number> = {};

  const projections = await readProjectionRuns(cwd);
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

  const projectionIds = new Set<string>();
  let liveEntities = 0;
  for (const run of projections) {
    projectionIds.add(run.id);
    const evts = byEntity.get(run.id);
    if (!evts || evts.length === 0) {
      issues.push({
        runId: run.id,
        kind: "missing_in_ledger",
        detail: "JSON projection exists with zero ledger facts (legacy pre-ledger run)",
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
    if (last.eventType === "coordination.run.deleted") {
      issues.push({
        runId: run.id,
        kind: "projection_stale",
        detail: "ledger deleted this run but the JSON projection still exists",
      });
      continue;
    }
    const payload = last.payload as { run?: CoordinationRun } | null;
    if (!payload?.run) {
      issues.push({
        runId: run.id,
        kind: "ledger_payload_invalid",
        detail: "live ledger event missing run payload — store.load would throw",
      });
      continue;
    }
    const ledgerRun = payload.run;
    if (ledgerRun.status !== run.status) {
      issues.push({
        runId: run.id,
        kind: "status_mismatch",
        detail: `json=${run.status} ledger=${ledgerRun.status} (ledger authoritative)`,
      });
    }
    if ((run.planRevision ?? 0) !== (ledgerRun.planRevision ?? 0)) {
      issues.push({
        runId: run.id,
        kind: "plan_revision_mismatch",
        detail: `json=${run.planRevision ?? 0} ledger=${ledgerRun.planRevision ?? 0}`,
      });
    }
    const ledgerWorkers = new Map(ledgerRun.workers.map(w => [w.id, w]));
    const projectionWorkers = new Map(run.workers.map(w => [w.id, w]));
    const workerIds = new Set([...ledgerWorkers.keys(), ...projectionWorkers.keys()]);
    for (const workerId of workerIds) {
      const mirrored = ledgerWorkers.get(workerId);
      const projected = projectionWorkers.get(workerId);
      if (!projected) {
        issues.push({
          runId: run.id,
          kind: "worker_status_mismatch",
          detail: `worker ${workerId} present in ledger but absent from projection`,
        });
        continue;
      }
      if (!mirrored) {
        issues.push({
          runId: run.id,
          kind: "worker_status_mismatch",
          detail: `worker ${workerId} present in projection but absent from ledger run`,
        });
        continue;
      }
      if (mirrored.status !== projected.status || (mirrored.attempt ?? 0) !== (projected.attempt ?? 0)) {
        issues.push({
          runId: run.id,
          kind: "worker_status_mismatch",
          detail: `worker ${workerId}: json={${projected.status},attempt=${projected.attempt ?? 0}} ledger={${mirrored.status},attempt=${mirrored.attempt ?? 0}}`,
        });
      }
    }
  }

  // Ledger side: live entities with no projection file, and payload sanity.
  for (const [entityId, evts] of byEntity) {
    const last = evts[evts.length - 1];
    if (last.eventType === "coordination.run.deleted") continue;
    liveEntities += 1;
    if (projectionIds.has(entityId)) continue;
    const payload = last.payload as { run?: CoordinationRun } | null;
    if (!payload?.run) {
      issues.push({
        runId: entityId,
        kind: "ledger_payload_invalid",
        detail: "live ledger event missing run payload — store.load would throw",
      });
      continue;
    }
    issues.push({
      runId: entityId,
      kind: "projection_missing",
      detail: "live ledger run has no JSON projection file (projection write failed or file lost)",
    });
  }

  issues.sort((a, b) => a.runId.localeCompare(b.runId) || a.kind.localeCompare(b.kind));
  return {
    scannedRuns: projections.length,
    ledgerEntities: liveEntities,
    ledgerEventsRead: events.length,
    issues,
    unknownEventTypes,
    truncated,
    ok: issues.length === 0 && !truncated,
  };
}
