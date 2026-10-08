// src/kernel/graph-ledger-reconcile.ts
//
// R2.7 — compare graph JSON files (`.alix/graphs/<id>.json` + `<id>.runs.json`)
// against the transactional ledger. Read-only. Counts unknown event types and
// reports read truncation (R2 exit conditions).
//
// Issue kinds:
//   missing_in_ledger     — graph file exists, zero ledger facts (legacy)
//   record_mismatch       — graph status differs from the ledger payload
//   projection_missing    — live ledger graph/attempt has no file record
//   version_behind        — last event entityVersion ≠ event count
//   ledger_payload_invalid — live event without a graph payload

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GRAPH_LEDGER_EVENT_TYPES } from "./graph-ledger.js";
import type { TaskGraph } from "./task-graph.js";
import { getSharedLedger } from "../storage/runtime-ledger.js";

export type GraphReconcileIssueKind =
  | "missing_in_ledger"
  | "record_mismatch"
  | "projection_missing"
  | "version_behind"
  | "ledger_payload_invalid";

export interface GraphReconcileIssue {
  graphId: string;
  kind: GraphReconcileIssueKind;
  detail: string;
}

export interface GraphReconcileReport {
  scannedGraphs: number;
  scannedAttempts: number;
  ledgerGraphs: number;
  ledgerAttempts: number;
  ledgerEventsRead: number;
  issues: GraphReconcileIssue[];
  unknownEventTypes: Record<string, number>;
  truncated: boolean;
  ok: boolean;
}

const KNOWN_TYPES = new Set<string>(GRAPH_LEDGER_EVENT_TYPES);

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
        entityType: r.entityType ?? "unknown",
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

interface GraphProjection {
  graph: TaskGraph;
  attempts: Array<{ attempt: number }>;
}

async function readGraphProjection(cwd: string): Promise<GraphProjection[]> {
  const dir = join(cwd, ".alix", "graphs");
  if (!existsSync(dir)) return [];
  const out: GraphProjection[] = [];
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".json") || file.endsWith(".runs.json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      const graph = JSON.parse(raw) as TaskGraph;
      if (!graph?.id) continue;
      let attempts: Array<{ attempt: number }> = [];
      const runsPath = join(dir, `${file.slice(0, -5)}.runs.json`);
      if (existsSync(runsPath)) {
        try {
          const runsRaw = await readFile(runsPath, "utf-8");
          attempts = (JSON.parse(runsRaw) as Array<{ attempt: number }>) ?? [];
        } catch {
          attempts = [];
        }
      }
      out.push({ graph, attempts });
    } catch {
      // corrupt graph file — invisible to both sides of the comparison
    }
  }
  return out;
}

export async function reconcileGraphLedger(cwd: string): Promise<GraphReconcileReport> {
  const issues: GraphReconcileIssue[] = [];
  const unknownEventTypes: Record<string, number> = {};

  const projections = await readGraphProjection(cwd);
  const { events, truncated } = drainLedgerEvents(cwd, new Set(["graph", "graphAttempt"]));

  const graphsByEntity = new Map<string, LedgerEventRow[]>();
  const attemptsByEntity = new Map<string, LedgerEventRow>();
  for (const e of events) {
    if (!KNOWN_TYPES.has(e.eventType)) {
      unknownEventTypes[e.eventType] = (unknownEventTypes[e.eventType] ?? 0) + 1;
    }
    if (e.entityType === "graphAttempt") {
      attemptsByEntity.set(e.entityId, e);
      continue;
    }
    const list = graphsByEntity.get(e.entityId) ?? [];
    list.push(e);
    graphsByEntity.set(e.entityId, list);
  }

  let scannedAttempts = 0;
  const projectionGraphIds = new Set<string>();
  for (const { graph, attempts } of projections) {
    projectionGraphIds.add(graph.id);
    const evts = graphsByEntity.get(graph.id);
    if (!evts || evts.length === 0) {
      issues.push({
        graphId: graph.id,
        kind: "missing_in_ledger",
        detail: "graph file exists with zero ledger facts (legacy pre-ledger graph)",
      });
    } else {
      const last = evts[evts.length - 1];
      if (last.entityVersion !== evts.length) {
        issues.push({
          graphId: graph.id,
          kind: "version_behind",
          detail: `last entityVersion ${last.entityVersion} != event count ${evts.length}`,
        });
      }
      const payload = last.payload as { graph?: TaskGraph } | null;
      if (!payload?.graph) {
        issues.push({
          graphId: graph.id,
          kind: "ledger_payload_invalid",
          detail: "live graph event missing graph payload",
        });
      } else if (payload.graph.status !== graph.status) {
        issues.push({
          graphId: graph.id,
          kind: "record_mismatch",
          detail: `json=${graph.status} ledger=${payload.graph.status} (JSON authoritative in dual-write phase)`,
        });
      }
    }
    for (const attempt of attempts) {
      scannedAttempts += 1;
      const entityId = `${graph.id}#attempt-${attempt.attempt}`;
      if (!attemptsByEntity.has(entityId)) {
        issues.push({
          graphId: graph.id,
          kind: "record_mismatch",
          detail: `rerun attempt ${attempt.attempt} present in runs.json but not mirrored to the ledger`,
        });
      }
    }
  }

  let ledgerGraphs = 0;
  for (const [graphId, evts] of graphsByEntity) {
    ledgerGraphs += 1;
    if (projectionGraphIds.has(graphId)) continue;
    const last = evts[evts.length - 1];
    const payload = last.payload as { graph?: TaskGraph } | null;
    if (!payload?.graph) {
      issues.push({
        graphId,
        kind: "ledger_payload_invalid",
        detail: "live graph event missing graph payload",
      });
      continue;
    }
    issues.push({
      graphId,
      kind: "projection_missing",
      detail: "live ledger graph has no JSON file (write failed or deleted)",
    });
  }
  for (const entityId of attemptsByEntity.keys()) {
    const [graphId, attemptPart] = entityId.split("#attempt-");
    const projection = projections.find(p => p.graph.id === graphId);
    if (projection && !projection.attempts.some(a => String(a.attempt) === attemptPart)) {
      issues.push({
        graphId,
        kind: "projection_missing",
        detail: `rerun attempt ${attemptPart} recorded in the ledger but absent from runs.json`,
      });
    }
  }

  issues.sort((a, b) => a.graphId.localeCompare(b.graphId) || a.kind.localeCompare(b.kind));
  return {
    scannedGraphs: projections.length,
    scannedAttempts,
    ledgerGraphs,
    ledgerAttempts: attemptsByEntity.size,
    ledgerEventsRead: events.length,
    issues,
    unknownEventTypes,
    truncated,
    ok: issues.length === 0 && !truncated,
  };
}
