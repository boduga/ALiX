// src/runtime/execution-state/execution-ledger-reconcile.ts
//
// R2.6 — compare execution-state JSON snapshots (`.alix/executions/<id>/
// state.json`) against the transactional ledger. Read-only. Counts unknown
// event types and reports read truncation (R2 exit conditions).
//
// Issue kinds:
//   missing_in_ledger     — snapshot exists, zero ledger facts (legacy)
//   record_mismatch       — snapshot version/status differs from ledger
//   projection_missing    — live ledger execution has no snapshot file
//   version_behind        — last event entityVersion ≠ event count
//   ledger_payload_invalid — live event without a state payload

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stateFilePath } from "./execution-state-store.js";
import { executionStateStoreDir } from "./execution-state-emitter.js";
import { getSharedLedger } from "../../storage/runtime-ledger.js";
import type { ExecutionState } from "./execution-state.js";

export type ExecutionReconcileIssueKind =
  | "missing_in_ledger"
  | "record_mismatch"
  | "projection_missing"
  | "version_behind"
  | "ledger_payload_invalid";

export interface ExecutionReconcileIssue {
  executionId: string;
  kind: ExecutionReconcileIssueKind;
  detail: string;
}

export interface ExecutionReconcileReport {
  scannedSnapshots: number;
  ledgerEntities: number;
  ledgerEventsRead: number;
  issues: ExecutionReconcileIssue[];
  unknownEventTypes: Record<string, number>;
  truncated: boolean;
  ok: boolean;
}

const KNOWN_TYPES = new Set(["execution.state_created", "execution.state_saved"]);

interface LedgerEventRow {
  eventType: string;
  entityType: string;
  entityId: string;
  entityVersion: number;
  payload: unknown;
  ledgerSeq: number;
}

function drainLedgerEvents(cwd: string, entityTypes: ReadonlySet<string>, maxPages = 50, pageSize = 2000): { events: LedgerEventRow[]; truncated: boolean } {
  const ledger = getSharedLedger(cwd);
  const events: LedgerEventRow[] = [];
  let cursor = 0;
  for (let page = 0; page < maxPages; page++) {
    const rows = ledger.readEvents({ sinceSeq: cursor, limit: pageSize });
    for (const r of rows) {
      if (!entityTypes.has(r.entityType)) continue;
      events.push({
        eventType: r.eventType,
        entityType: r.entityType,
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

export async function reconcileExecutionLedger(
  storeDir: string = executionStateStoreDir(),
  ledgerCwd?: string,
): Promise<ExecutionReconcileReport> {
  const cwd = ledgerCwd ?? deriveCwd(storeDir);
  const issues: ExecutionReconcileIssue[] = [];
  const unknownEventTypes: Record<string, number> = {};

  // Projection side: snapshot files under the store dir.
  const projection = new Map<string, { version: number; status: string }>();
  if (existsSync(storeDir)) {
    for (const entry of await readdir(storeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = stateFilePath(storeDir, entry.name);
      if (!existsSync(path)) continue;
      try {
        const raw = await readFile(path, "utf-8");
        const parsed = JSON.parse(raw) as { state?: ExecutionState } & ExecutionState;
        const state = parsed.state ?? (parsed as ExecutionState);
        projection.set(entry.name, { version: state.version, status: state.status });
      } catch {
        // corrupt snapshot — absence from this map surfaces as projection_missing
        // only if the ledger knows it; otherwise it is invisible to both sides.
      }
    }
  }

  const { events, truncated } = drainLedgerEvents(cwd, new Set(["execution"]));
  const byEntity = new Map<string, LedgerEventRow[]>();
  for (const e of events) {
    if (!KNOWN_TYPES.has(e.eventType)) {
      unknownEventTypes[e.eventType] = (unknownEventTypes[e.eventType] ?? 0) + 1;
    }
    const list = byEntity.get(e.entityId) ?? [];
    list.push(e);
    byEntity.set(e.entityId, list);
  }

  let liveEntities = 0;
  for (const [executionId, snap] of projection) {
    const evts = byEntity.get(executionId);
    if (!evts || evts.length === 0) {
      issues.push({
        executionId,
        kind: "missing_in_ledger",
        detail: "snapshot exists with zero ledger facts (legacy pre-ledger execution)",
      });
      continue;
    }
    const last = evts[evts.length - 1];
    if (last.entityVersion !== evts.length) {
      issues.push({
        executionId,
        kind: "version_behind",
        detail: `last entityVersion ${last.entityVersion} != event count ${evts.length}`,
      });
    }
    const payload = last.payload as { state?: ExecutionState } | null;
    if (!payload?.state) {
      issues.push({
        executionId,
        kind: "ledger_payload_invalid",
        detail: "live execution event missing state payload",
      });
      continue;
    }
    if (payload.state.version !== snap.version || payload.state.status !== snap.status) {
      issues.push({
        executionId,
        kind: "record_mismatch",
        detail: `json={v${snap.version},${snap.status}} ledger={v${payload.state.version},${payload.state.status}} (ledger authoritative after R2.7)`,
      });
    }
  }

  for (const [entityId, evts] of byEntity) {
    liveEntities += 1;
    if (projection.has(entityId)) continue;
    const payload = evts[evts.length - 1].payload as { state?: ExecutionState } | null;
    if (!payload?.state) {
      issues.push({
        executionId: entityId,
        kind: "ledger_payload_invalid",
        detail: "live execution event missing state payload",
      });
      continue;
    }
    issues.push({
      executionId: entityId,
      kind: "projection_missing",
      detail: "live ledger execution has no snapshot file (write failed or deleted)",
    });
  }

  issues.sort((a, b) => a.executionId.localeCompare(b.executionId) || a.kind.localeCompare(b.kind));
  return {
    scannedSnapshots: projection.size,
    ledgerEntities: liveEntities,
    ledgerEventsRead: events.length,
    issues,
    unknownEventTypes,
    truncated,
    ok: issues.length === 0 && !truncated,
  };
}

/** Workspace root implied by a store dir ending in `.alix/executions`. */
function deriveCwd(storeDir: string): string {
  const suffix = join(".alix", "executions");
  if (storeDir.endsWith(suffix)) {
    const stripped = storeDir.slice(0, storeDir.length - suffix.length).replace(/[\\/]+$/, "");
    return stripped || ".";
  }
  // Custom/test store dirs are their own ledger root (mirrors
  // ExecutionStateStore.baseDirCwd — dirname() would desync the two).
  return storeDir;
}
