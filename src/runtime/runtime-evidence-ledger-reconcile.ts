// src/runtime/runtime-evidence-ledger-reconcile.ts
//
// R2.11 — compare the replay index and execution-evidence JSONL against the
// transactional ledger. Read-only. Counts unknown event types and reports
// read truncation (R2 exit conditions).
//
// Audit stores are INTENTIONALLY not mirrored (see src/audit/AGENTS.md):
// their hash-chained append-only JSONL is the integrity authority; a second
// copy would be a third truth source, not consolidation.
//
// Replay issue kinds: missing_in_ledger / record_mismatch / projection_missing
//                    / version_behind / ledger_payload_invalid
// Evidence issue kinds: missing_in_ledger / record_mismatch / projection_missing
//                      / version_behind / ledger_payload_invalid

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPLAY_LEDGER_EVENT_TYPES, type ReplayStatusEntry } from "./replay-status-index.js";
import { EVIDENCE_LEDGER_EVENT_TYPES } from "./execution-evidence-store.js";
import type { ExecutionEvidence } from "./contracts/execution-intent-contract.js";
import { drainLedgerEvents, type LedgerEventRow } from "../storage/runtime-ledger.js";
import { parseJsonl } from "../storage/jsonl-store.js";

function countUnknown(events: readonly LedgerEventRow[], known: ReadonlySet<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    if (!known.has(e.eventType)) out[e.eventType] = (out[e.eventType] ?? 0) + 1;
  }
  return out;
}

function lastPerEntity(events: readonly LedgerEventRow[]): Map<string, LedgerEventRow> {
  const map = new Map<string, LedgerEventRow>();
  for (const e of events) map.set(e.entityId, e); // drained in seq order
  return map;
}

// ── Replay index ──────────────────────────────────────────────────────

export interface ReplayReconcileReport {
  scannedEntries: number;
  ledgerEntities: number;
  ledgerEventsRead: number;
  issues: Array<{ replayId: string; kind: string; detail: string }>;
  unknownEventTypes: Record<string, number>;
  truncated: boolean;
  ok: boolean;
}

export async function reconcileReplayLedger(cwd: string): Promise<ReplayReconcileReport> {
  const issues: ReplayReconcileReport["issues"] = [];
  const indexPath = join(cwd, ".alix", "replays", "index.json");
  const entries: ReplayStatusEntry[] = existsSync(indexPath)
    ? ((JSON.parse(await readFile(indexPath, "utf-8")) as { entries?: ReplayStatusEntry[] }).entries ?? [])
    : [];

  const { events, truncated } = drainLedgerEvents(cwd, new Set(["replay"]));
  const unknownEventTypes = countUnknown(events, new Set(REPLAY_LEDGER_EVENT_TYPES));
  const lastByEntity = lastPerEntity(events);
  const versions = new Map<string, number>();
  for (const e of events) versions.set(e.entityId, (versions.get(e.entityId) ?? 0) + 1);

  const projectionIds = new Set<string>();
  for (const entry of entries) {
    projectionIds.add(entry.replayId);
    const last = lastByEntity.get(entry.replayId);
    if (!last) {
      issues.push({ replayId: entry.replayId, kind: "missing_in_ledger", detail: "index entry with zero ledger facts (legacy pre-ledger replay)" });
      continue;
    }
    if ((versions.get(entry.replayId) ?? 0) !== last.entityVersion) {
      issues.push({ replayId: entry.replayId, kind: "version_behind", detail: `last entityVersion ${last.entityVersion} != event count ${versions.get(entry.replayId)}` });
    }
    const payload = last.payload as { entry?: ReplayStatusEntry } | null;
    if (!payload?.entry) {
      issues.push({ replayId: entry.replayId, kind: "ledger_payload_invalid", detail: "live replay event missing entry payload" });
      continue;
    }
    if (payload.entry.status !== entry.status) {
      issues.push({ replayId: entry.replayId, kind: "record_mismatch", detail: `status: json=${entry.status} ledger=${payload.entry.status}` });
    }
  }

  let ledgerEntities = 0;
  for (const [entityId, last] of lastByEntity) {
    ledgerEntities += 1;
    if (projectionIds.has(entityId)) continue;
    const payload = last.payload as { entry?: ReplayStatusEntry } | null;
    if (!payload?.entry) {
      issues.push({ replayId: entityId, kind: "ledger_payload_invalid", detail: "live replay event missing entry payload" });
      continue;
    }
    issues.push({ replayId: entityId, kind: "projection_missing", detail: "live ledger replay has no index entry" });
  }

  issues.sort((a, b) => a.replayId.localeCompare(b.replayId) || a.kind.localeCompare(b.kind));
  return {
    scannedEntries: entries.length,
    ledgerEntities,
    ledgerEventsRead: events.length,
    issues,
    unknownEventTypes,
    truncated,
    ok: issues.length === 0 && !truncated,
  };
}

// ── Execution evidence ────────────────────────────────────────────────

export interface EvidenceReconcileReport {
  scannedRecords: number;
  ledgerEntities: number;
  ledgerEventsRead: number;
  issues: Array<{ evidenceId: string; kind: string; detail: string }>;
  unknownEventTypes: Record<string, number>;
  truncated: boolean;
  ok: boolean;
}

export async function reconcileEvidenceLedger(cwd: string, evidencePath?: string): Promise<EvidenceReconcileReport> {
  const issues: EvidenceReconcileReport["issues"] = [];
  // Production writes to two locations (governance CLI uses cwd directly;
  // agent-loop/governance handlers use .alix/governance/). Read both.
  const paths = evidencePath
    ? [evidencePath]
    : [join(cwd, ".alix", "governance", "execution-evidence.jsonl"), join(cwd, "execution-evidence.jsonl")];
  const records: ExecutionEvidence[] = [];
  const seenIds = new Set<string>();
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const { records: parsed } = parseJsonl<ExecutionEvidence>(await readFile(path, "utf-8"));
    for (const record of parsed) {
      if (seenIds.has(record.evidenceId)) continue;
      seenIds.add(record.evidenceId);
      records.push(record);
    }
  }

  const { events, truncated } = drainLedgerEvents(cwd, new Set(["executionEvidence"]));
  const unknownEventTypes = countUnknown(events, new Set(EVIDENCE_LEDGER_EVENT_TYPES));
  const lastByEntity = lastPerEntity(events);
  const versions = new Map<string, number>();
  for (const e of events) versions.set(e.entityId, (versions.get(e.entityId) ?? 0) + 1);

  const projectionIds = new Set<string>();
  for (const record of records) {
    projectionIds.add(record.evidenceId);
    const last = lastByEntity.get(record.evidenceId);
    if (!last) {
      issues.push({ evidenceId: record.evidenceId, kind: "missing_in_ledger", detail: "JSONL record with zero ledger facts (legacy pre-ledger evidence)" });
      continue;
    }
    if ((versions.get(record.evidenceId) ?? 0) !== last.entityVersion) {
      issues.push({ evidenceId: record.evidenceId, kind: "version_behind", detail: `last entityVersion ${last.entityVersion} != event count ${versions.get(record.evidenceId)}` });
    }
    const payload = last.payload as { evidence?: ExecutionEvidence } | null;
    if (!payload?.evidence) {
      issues.push({ evidenceId: record.evidenceId, kind: "ledger_payload_invalid", detail: "live evidence event missing evidence payload" });
      continue;
    }
    if (
      payload.evidence.outcome !== record.outcome ||
      payload.evidence.intentId !== record.intentId ||
      payload.evidence.verificationPassed !== record.verificationPassed
    ) {
      issues.push({
        evidenceId: record.evidenceId,
        kind: "record_mismatch",
        detail: `outcome/intentId/verificationPassed: json={${record.outcome},${record.intentId},${record.verificationPassed}} ledger={${payload.evidence.outcome},${payload.evidence.intentId},${payload.evidence.verificationPassed}}`,
      });
    }
  }

  let ledgerEntities = 0;
  for (const [entityId, last] of lastByEntity) {
    ledgerEntities += 1;
    if (projectionIds.has(entityId)) continue;
    const payload = last.payload as { evidence?: ExecutionEvidence } | null;
    if (!payload?.evidence) {
      issues.push({ evidenceId: entityId, kind: "ledger_payload_invalid", detail: "live evidence event missing evidence payload" });
      continue;
    }
    issues.push({ evidenceId: entityId, kind: "projection_missing", detail: "live ledger evidence absent from the JSONL store" });
  }

  issues.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId) || a.kind.localeCompare(b.kind));
  return {
    scannedRecords: records.length,
    ledgerEntities,
    ledgerEventsRead: events.length,
    issues,
    unknownEventTypes,
    truncated,
    ok: issues.length === 0 && !truncated,
  };
}
