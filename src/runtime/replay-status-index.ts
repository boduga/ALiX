/**
 * replay-status-index.ts — Global index of replay lifecycle statuses.
 *
 * Persisted at .alix/replays/index.json.
 * Provides a single source of truth for whether a replay has been
 * captured, rolled back, or is in progress.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { getSharedLedger } from "../storage/runtime-ledger.js";

/** Ledger event vocabulary for the replay-index domain (R2.11). */
export const REPLAY_LEDGER_EVENT_TYPES = [
  "replay.status_created",
  "replay.status_updated",
] as const;

// ─── R2.11 dual-write status (per workspace) ─────────────────────────
type ReplayLedgerStatus = { appends: number; failures: number; lastError?: string };
const statusByCwd = new Map<string, ReplayLedgerStatus>();

function statusFor(cwd: string): ReplayLedgerStatus {
  let s = statusByCwd.get(cwd);
  if (!s) {
    s = { appends: 0, failures: 0 };
    statusByCwd.set(cwd, s);
  }
  return s;
}

/** Observable dual-write health (R2: failures must never be silent). */
export function replayLedgerStatus(cwd: string): ReplayLedgerStatus {
  const s = statusFor(cwd);
  return { ...s, ...(s.lastError !== undefined ? { lastError: s.lastError } : {}) };
}

/** Reset counters (tests). */
export function resetReplayLedgerStatus(cwd: string): void {
  statusByCwd.delete(cwd);
}

export type ReplayStatus =
  | "capturing"
  | "completed"
  | "rollback-dry-run"
  | "rollback-running"
  | "rollback-completed"
  | "rollback-partial"
  | "locked";

export type ReplayStatusEntry = {
  replayId: string;
  status: ReplayStatus;
  createdAt: string;
  updatedAt: string;
  replayMode?: string;
};

export type ReplayStatusIndexData = {
  entries: ReplayStatusEntry[];
};

export class ReplayStatusIndex {
  constructor(private cwd: string) {}

  private indexPath(): string {
    return join(this.cwd, ".alix", "replays", "index.json");
  }

  async load(): Promise<ReplayStatusIndexData> {
    const path = this.indexPath();
    if (!existsSync(path)) return { entries: [] };
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ReplayStatusIndexData;
    } catch {
      return { entries: [] };
    }
  }

  async save(data: ReplayStatusIndexData): Promise<void> {
    const path = this.indexPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  }

  async getEntry(replayId: string): Promise<ReplayStatusEntry | undefined> {
    const data = await this.load();
    return data.entries.find(e => e.replayId === replayId);
  }

  async getStatus(replayId: string): Promise<ReplayStatus | undefined> {
    const entry = await this.getEntry(replayId);
    return entry?.status;
  }

  async getAll(): Promise<ReplayStatusEntry[]> {
    const data = await this.load();
    return data.entries;
  }

  async setStatus(replayId: string, status: ReplayStatus, mode?: string): Promise<void> {
    const data = await this.load();
    const existing = data.entries.find(e => e.replayId === replayId);
    const now = new Date().toISOString();
    if (existing) {
      existing.status = status;
      existing.updatedAt = now;
      if (mode) existing.replayMode = mode;
    } else {
      data.entries.push({
        replayId,
        status,
        createdAt: now,
        updatedAt: now,
        replayMode: mode,
      });
    }
    await this.save(data);
    // R2.11 dual-write: mirror the entry after the durable write (JSON
    // authoritative this phase); failures counted, never thrown.
    const entry = data.entries.find(e => e.replayId === replayId);
    if (entry) this.mirrorEntry(entry);
  }

  private mirrorEntry(entry: ReplayStatusEntry): void {
    const s = statusFor(this.cwd);
    try {
      const ledger = getSharedLedger(this.cwd);
      const expected = ledger.entityVersion(entry.replayId);
      const eventType = expected === 0 ? "replay.status_created" : "replay.status_updated";
      const res = ledger.append({
        event: {
          eventId: randomUUID(),
          eventType,
          schemaVersion: 1,
          entityType: "replay",
          entityId: entry.replayId,
          entityVersion: expected + 1,
          correlationId: entry.replayId,
          actor: { type: "system", id: "replay-status-index" },
          occurredAt: entry.updatedAt,
          recordedAt: new Date().toISOString(),
          payload: { entry },
        },
        expectedVersion: expected,
      });
      if (res.ok) s.appends += 1;
      else {
        s.failures += 1;
        s.lastError = `${res.reason}: ${res.detail}`;
      }
    } catch (err) {
      s.failures += 1;
      s.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  async ensureReplay(replayId: string, mode?: string): Promise<void> {
    const existing = await this.getStatus(replayId);
    if (!existing) {
      await this.setStatus(replayId, "capturing", mode);
    }
  }
}
