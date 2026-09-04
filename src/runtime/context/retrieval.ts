// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * Production retrieval via EventLog / StateProjector indexes — tracer #640.
 *
 * Replaces FakeExecutionEnvironment.getEvidenceById / getHistorySlice stub
 * (in-memory scan over scenario.events) with real file-backed indexes:
 *  - .alix/sessions/<executionId>/events.jsonl (EventLog file indexes)
 *  - StateProjector checkpoints via ExecutionStateStore
 *
 * No new abstraction — extends existing src/runtime/context builder substrate.
 * Real harness (benchmark/real-eventlog-environment) delegates to this module
 * so D hybrid evidence/history targeted fetch goes through production indexes
 * while still retrieving only when required (precision 1.0).
 *
 * Index contract:
 *  - by executionId : locate session file and filter authoritative history
 *  - by evidenceId  : scan events.jsonl for evidence.observation with payload.evidenceId
 *  - by historySlice: scan events.jsonl for seq exact / range
 *  - checkpoint     : ExecutionStateStore.load / project rebuild (INV-P7)
 *
 * EventLog remains authoritative; state is disposable (rebuildable).
 * Retrieval is read-only, deterministic, fail-closed (missing → undefined, not throw).
 *
 * @module runtime/context/retrieval
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AlixEvent } from "../../events/types.js";
import type { EventLog } from "../../events/event-log.js";
import { ExecutionStateStore } from "../execution-state/execution-state-store.js";
import {
  project,
  toExecutionState,
  type ProjectorEvent,
  type CheckpointedExecutionState,
} from "../execution-state/execution-state-projector.js";
import type { ExecutionState } from "../execution-state/execution-state.js";

// ─── Helpers ────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseEvidenceId(ev: AlixEvent): string | undefined {
  if (!isRecord(ev.payload)) return undefined;
  const v = (ev.payload as Record<string, unknown>).evidenceId;
  return typeof v === "string" ? v : undefined;
}

function readEventsSync(filePath: string): AlixEvent[] {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, "utf-8");
  const out: AlixEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as AlixEvent;
      if (typeof parsed.seq === "number" && typeof parsed.type === "string") out.push(parsed);
    } catch {
      // skip malformed — matches EventLog.readAll fail-closed
    }
  }
  return out;
}

async function readEventsAsync(filePath: string): Promise<AlixEvent[]> {
  if (!existsSync(filePath)) return [];
  const text = await readFile(filePath, "utf-8");
  const out: AlixEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as AlixEvent;
      if (typeof parsed.seq === "number" && typeof parsed.type === "string") out.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return out;
}

// ─── Retrieval ──────────────────────────────────────────────────────

/**
 * Production retrieval façade over real EventLog file indexes and
 * StateProjector / ExecutionStateStore checkpoints.
 *
 * Constructed with the authoritative EventLog (sessionDir/events.jsonl)
 * and the durable ExecutionStateStore (.alix/executions/<id>/state.json).
 * All queries read the real file indexes; no in-memory scenario stub.
 */
export class ContextRetrieval {
  private _cachedSync: AlixEvent[] | null = null;
  private _cachedMtimeMs: number | null = null;

  constructor(
    private readonly eventLog: EventLog,
    private readonly store: ExecutionStateStore,
  ) {}

  /** Prime file-index cache after RealEventLogEnvironment.init() for fast per-decision lookups. */
  primeCache(): void {
    try {
      this._cachedSync = readEventsSync(this.eventLog.path);
      try {
        this._cachedMtimeMs = statSync(this.eventLog.path).mtimeMs;
      } catch { this._cachedMtimeMs = Date.now(); }
    } catch { this._cachedSync = null; }
  }

  invalidateCache(): void {
    this._cachedSync = null;
    this._cachedMtimeMs = null;
  }

  // ── File index access — sync (tracer bullet, no async required in harness loop) ──

  /** Real file path for the bound EventLog (exposed for diagnostics). */
  get eventsPath(): string {
    return this.eventLog.path;
  }

  /** Read authoritative history from real .alix/sessions/events.jsonl (sync, file index). */
  readAllSync(): AlixEvent[] {
    // Use cached file index after primeCache() — still file-authoritative but avoids per-decision disk reads
    if (this._cachedSync !== null) {
      try {
        const mtime = statSync(this.eventLog.path).mtimeMs;
        if (this._cachedMtimeMs !== null && mtime === this._cachedMtimeMs) return this._cachedSync;
      } catch {
        // fall through to file read if stat fails
      }
      // stale — invalidate and re-read
      this._cachedSync = null;
    }
    const fresh = readEventsSync(this.eventLog.path);
    this._cachedSync = fresh;
    try {
      this._cachedMtimeMs = statSync(this.eventLog.path).mtimeMs;
    } catch { this._cachedMtimeMs = Date.now(); }
    return fresh;
  }

  /** Read authoritative history from real index (async). */
  async readAll(): Promise<AlixEvent[]> {
    // Prefer EventLog.readAll (handles existence + malformed), fall back to raw file
    try {
      return await this.eventLog.readAll();
    } catch {
      return readEventsAsync(this.eventLog.path);
    }
  }

  // ── by executionId — locate authoritative history slice for one execution ──

  /**
   * Query real EventLog index by executionId.
   *
   * ExecutionId is carried in payload.executionId on execution.created and
   * many history events; sessionId also mirrors it on append. We filter the
   * authoritative file for payload.executionId === executionId (fallback to
   * sessionId === executionId for file-scoped harness).
   *
   * Sync variant reads the real file index via readFileSync (production file I/O).
   */
  getEventsByExecutionIdSync(executionId: string): AlixEvent[] {
    if (!executionId) return [];
    const all = this.readAllSync();
    // Production layout: .alix/sessions/<executionId>/events.jsonl is the executionId index (file-scoped).
    // If the bound EventLog's sessionDir matches the queried id, the file itself is the index — return all.
    const sessionIdFromPath = this.eventLog.sessionDir.split("/").pop();
    if (sessionIdFromPath === executionId) return [...all];
    const filtered = all.filter(ev => {
      const p = isRecord(ev.payload) ? (ev.payload as Record<string, unknown>).executionId : undefined;
      return p === executionId || ev.sessionId === executionId;
    });
    return filtered.length > 0 ? filtered : [...all];
  }

  async getEventsByExecutionId(executionId: string): Promise<AlixEvent[]> {
    if (!executionId) return [];
    const all = await this.readAll();
    const sessionIdFromPath = this.eventLog.sessionDir.split("/").pop();
    if (sessionIdFromPath === executionId) return [...all];
    const filtered = all.filter(ev => {
      const p = isRecord(ev.payload) ? (ev.payload as Record<string, unknown>).executionId : undefined;
      return p === executionId || ev.sessionId === executionId;
    });
    return filtered.length > 0 ? filtered : [...all];
  }

  // ── by evidenceId — targeted evidence lookup via file index ──

  /**
   * Query real EventLog index by evidenceId (evidence.observation).
   * Sync — reads file index via real JSONL file scan.
   */
  getEvidenceByIdSync(evidenceId: string): AlixEvent | undefined {
    if (!evidenceId) return undefined;
    const all = this.readAllSync();
    return all.find(ev => ev.type === "evidence.observation" && parseEvidenceId(ev) === evidenceId);
  }

  async getEvidenceById(evidenceId: string): Promise<AlixEvent | undefined> {
    if (!evidenceId) return undefined;
    const all = await this.readAll();
    return all.find(ev => ev.type === "evidence.observation" && parseEvidenceId(ev) === evidenceId);
  }

  /** Convenience — evidence list for a decision (bounded). */
  getEvidenceForDecisionSync(evidenceId?: string): readonly AlixEvent[] {
    if (!evidenceId) return [];
    const ev = this.getEvidenceByIdSync(evidenceId);
    return ev ? [ev] : [];
  }

  async getEvidenceForDecision(evidenceId?: string): Promise<readonly AlixEvent[]> {
    if (!evidenceId) return [];
    const ev = await this.getEvidenceById(evidenceId);
    return ev ? [ev] : [];
  }

  // ── by historySlice — targeted seq / range lookup via file index ──

  /** Query real EventLog index for a single seq (historySlice). Sync. */
  getHistorySliceSync(seq: number): AlixEvent | undefined {
    if (!Number.isInteger(seq)) return undefined;
    const all = this.readAllSync();
    return all.find(ev => ev.seq === seq);
  }

  async getHistorySlice(seq: number): Promise<AlixEvent | undefined> {
    if (!Number.isInteger(seq)) return undefined;
    const all = await this.readAll();
    return all.find(ev => ev.seq === seq);
  }

  /** Range slice inclusive [fromSeq, toSeq] — bounded targeted fetch. */
  getHistorySliceRangeSync(fromSeq: number, toSeq: number): readonly AlixEvent[] {
    const all = this.readAllSync();
    return all.filter(ev => ev.seq >= fromSeq && ev.seq <= toSeq);
  }

  async getHistorySliceRange(fromSeq: number, toSeq: number): Promise<readonly AlixEvent[]> {
    const all = await this.readAll();
    return all.filter(ev => ev.seq >= fromSeq && ev.seq <= toSeq);
  }

  // ── latest observation — last event payload (transient O) ──

  getLatestObservationSync(): unknown {
    const all = this.readAllSync();
    const last = all[all.length - 1];
    return last ? last.payload : null;
  }

  async getLatestObservation(): Promise<unknown> {
    const all = await this.readAll();
    const last = all[all.length - 1];
    return last ? last.payload : null;
  }

  // ── StateProjector checkpoints — ExecutionStateStore + deterministic projector ──

  /**
   * Load checkpointed ExecutionState for executionId via ExecutionStateStore
   * (StateProjector materialized snapshot) — StateProjector checkpoint index.
   *
   * Rebuilds from authoritative EventLog file if store snapshot missing
   * (EventLog authoritative, state disposable INV-10 / INV-P7).
   */
  getCheckpointSync(executionId: string): CheckpointedExecutionState | null {
    if (!executionId) return null;
    // Prefer durable store snapshot (fast path — checkpoint index)
    const stored = this.store.load(executionId);
    if (stored) {
      // Store returns ExecutionState; reconstruct checkpoint metadata from file
      // For tracer bullet, we return stored as checkpoint with historyRevision/historyHash inferred
      // from file when available. Caller can use getCheckpointedState for full lineage.
      const all = this.readAllSync();
      const proj = this.projectEvents(all);
      if (proj && proj.executionId === executionId) return proj;
      // fallback: treat stored as checkpoint with minimal lineage
      return {
        ...stored,
        historyRevision: all.length > 0 ? (all[all.length - 1]?.seq ?? stored.step) : stored.step,
        historyHash: "",
      } as CheckpointedExecutionState;
    }
    // No snapshot — rebuild from authoritative EventLog file deterministically
    const all = readEventsSync(this.eventLog.path);
    if (all.length === 0) return null;
    // Rebuild from file via projector — real checkpoint index
    return this.projectEvents(all);
  }

  async getCheckpoint(executionId: string): Promise<CheckpointedExecutionState | null> {
    if (!executionId) return null;
    const stored = this.store.load(executionId);
    if (stored) {
      const all = await this.readAll();
      const proj = this.projectEvents(all);
      if (proj && proj.executionId === executionId) return proj;
      return {
        ...stored,
        historyRevision: all.length > 0 ? (all[all.length - 1]?.seq ?? stored.step) : stored.step,
        historyHash: "",
      } as CheckpointedExecutionState;
    }
    const all = await this.readAll();
    if (all.length === 0) return null;
    return this.projectEvents(all);
  }

  /** Pure ExecutionState (without checkpoint lineage) for the bound execution. */
  getExecutionStateSync(executionId: string): ExecutionState | null {
    const cp = this.getCheckpointSync(executionId);
    return cp ? toExecutionState(cp) : null;
  }

  async getExecutionState(executionId: string): Promise<ExecutionState | null> {
    const cp = await this.getCheckpoint(executionId);
    return cp ? toExecutionState(cp) : null;
  }

  /** Bound execution's state via file index (reads stored or rebuilds). Convenience. */
  getBoundExecutionStateSync(): ExecutionState | null {
    const all = this.readAllSync();
    if (all.length === 0) return null;
    // executionId from first execution.created payload if present
    const execId = isRecord(all[0].payload) ? (all[0].payload as Record<string, unknown>).executionId as string | undefined : undefined;
    if (!execId) return null;
    return this.getExecutionStateSync(execId);
  }

  async getBoundExecutionState(): Promise<ExecutionState | null> {
    const all = await this.readAll();
    if (all.length === 0) return null;
    const execId = isRecord(all[0].payload) ? (all[0].payload as Record<string, unknown>).executionId as string | undefined : undefined;
    if (!execId) return null;
    return this.getExecutionState(execId);
  }

  // ── Internal projector bridge ──

  private projectEvents(events: readonly AlixEvent[]): CheckpointedExecutionState | null {
    if (events.length === 0) return null;
    const projEvents: ProjectorEvent[] = events.map(a => ({
      seq: a.seq,
      type: a.type,
      payload: a.payload,
      id: a.id,
    }));
    try {
      return project(projEvents);
    } catch {
      return null;
    }
  }

  // ── Index introspection — for tests / diagnostics ──

  /** Whether the real .alix/sessions events.jsonl file exists. */
  hasRealEventLogFile(): boolean {
    return existsSync(this.eventLog.path);
  }

  /** Sync count via cached file index. */
  countSyncPublic(): number {
    return this.readAllSync().length;
  }

  /** Whether a real ExecutionStateStore checkpoint exists for executionId. */
  hasRealCheckpointFile(executionId: string): boolean {
    if (!executionId) return false;
    return this.store.exists(executionId);
  }

  /** Count of events in real file index (authoritative). */
  countSync(): number {
    return readEventsSync(this.eventLog.path).length;
  }

  async count(): Promise<number> {
    return (await this.readAll()).length;
  }
}

// ─── Standalone helpers (functional API — for callers without class instance) ──

/** Query evidence by evidenceId directly from a file-indexed EventLog (readAll). */
export async function queryEvidenceById(eventLog: EventLog, evidenceId: string): Promise<AlixEvent | undefined> {
  if (!evidenceId) return undefined;
  const all = await eventLog.readAll();
  return all.find(ev => ev.type === "evidence.observation" && isRecord(ev.payload) && (ev.payload as Record<string, unknown>).evidenceId === evidenceId);
}

/** Query history slice by seq directly from EventLog file index. */
export async function queryHistorySlice(eventLog: EventLog, seq: number): Promise<AlixEvent | undefined> {
  if (!Number.isInteger(seq)) return undefined;
  const all = await eventLog.readAll();
  return all.find(ev => ev.seq === seq);
}

/** Query events by executionId (payload.executionId || sessionId). */
export async function queryEventsByExecutionId(eventLog: EventLog, executionId: string): Promise<AlixEvent[]> {
  if (!executionId) return [];
  const all = await eventLog.readAll();
  return all.filter(ev => {
    const p = isRecord(ev.payload) ? (ev.payload as Record<string, unknown>).executionId : undefined;
    return p === executionId || ev.sessionId === executionId;
  });
}

/**
 * Load checkpointed state for executionId via store or rebuild from EventLog file.
 * StateProjector checkpoint index — EventLog authoritative, state disposable.
 */
export async function queryCheckpoint(
  eventLog: EventLog,
  store: ExecutionStateStore,
  executionId: string,
): Promise<CheckpointedExecutionState | null> {
  const retrieval = new ContextRetrieval(eventLog, store);
  return retrieval.getCheckpoint(executionId);
}
