/**
 * ownership-registry.ts — Lock-protected lease-based ownership registry.
 *
 * All public mutation methods acquire the lock internally.
 * Private unlocked helpers (acquireUnlocked, releaseUnlocked, etc.)
 * require the caller to hold the lock (called from withLock).
 *
 * Transaction order:
 *   1. Acquire file lock
 *   2. Reload store from disk (inside lock)
 *   3. Expire stale active leases
 *   4. Detect conflicts / mutate records
 *   5. Atomic save (write tmp + rename) — only if anything changed
 *   6. Release lock
 *   7. Emit lifecycle events (after release — event failure never undoes a lease)
 *
 * Terminal records are preserved — prune() only removes records
 * older than the retention window. Each terminal transition has a
 * distinct timestamp: expiredAt / releasedAt / revokedAt.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  OwnershipRecord, OwnershipScope, OwnershipMode,
  OwnershipStore, AcquireResult, OwnershipEventSink,
} from "./ownership-types.js";
import { modesConflict } from "./ownership-types.js";
import { pathScopesOverlap, scopeContains, normalizePathScope, formatScope } from "./path-scope.js";
import { OwnershipLock } from "./ownership-lock.js";

const STORE_VERSION = 1;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min
const HISTORY_RETENTION_DAYS = 30;

export type OwnershipRegistryOptions = {
  eventSink?: OwnershipEventSink;
  sessionId?: string;
};

export type MutationAuthorization = {
  allowed: boolean;
  reason?: string;
};

export type AcquireRequest = {
  agentId: string;
  scope: OwnershipScope;
  mode: OwnershipMode;
  taskId?: string;
  sessionId?: string;
  ttlMs?: number;
  reason?: string;
};

export type MutationTarget = {
  path: string;
  origin: string;
  confident: boolean;
};

export class OwnershipRegistry {
  private records: OwnershipRecord[] = [];
  private storagePath: string;
  private cwd: string;
  private lock: OwnershipLock;
  private eventSink?: OwnershipEventSink;
  private sessionId?: string;
  private revision = 0;
  private changed = false;
  private pendingEvents: Array<{ event: string; data: Record<string, unknown> }> = [];

  constructor(cwd: string, opts?: OwnershipRegistryOptions) {
    this.cwd = cwd;
    this.storagePath = join(cwd, ".alix", "ownership", "ownership.json");
    this.lock = new OwnershipLock(cwd);
    this.eventSink = opts?.eventSink;
    this.sessionId = opts?.sessionId;
  }

  get currentRevision(): number {
    return this.revision;
  }

  // ═══ Internal load/save (only inside withLock) ═══════════════════

  private reloadFromDisk(): void {
    try {
      const raw = readFileSync(this.storagePath, "utf-8");
      const store = JSON.parse(raw) as OwnershipStore;
      this.records = (store.records ?? []).map(r => ({
        ...r,
        status: (r.status === "active" && this.isExpired(r)) ? ("expired" as const) : r.status,
      }));
      this.revision = store.revision ?? 0;
    } catch {
      this.records = [];
      this.revision = 0;
    }
  }

  private applyExpiration(): void {
    const now = new Date().toISOString();
    for (const r of this.records) {
      if (r.status === "active" && this.isExpired(r)) {
        r.status = "expired";
        r.expiredAt = now;
        this.changed = true;
        this.queueEvent("ownership.expired", { recordId: r.id, agentId: r.agentId });
      }
    }
  }

  private persistIfChanged(): void {
    if (!this.changed) return;
    this.revision++;
    const store: OwnershipStore = { version: STORE_VERSION, revision: this.revision, records: this.records };
    mkdirSync(dirname(this.storagePath), { recursive: true });
    const tmp = this.storagePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
    renameSync(tmp, this.storagePath);
  }

  /**
   * Execute fn inside lock. On failure: clear pending events, reload,
   * rethrow. Events emitted after lock release.
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const acquired = await this.lock.acquire();
    if (!acquired) {
      await this.emitEvents([{ event: "ownership.lock_failed", data: { reason: "timeout" } }]);
      return null;
    }
    let events: Array<{ event: string; data: Record<string, unknown> }> = [];
    try {
      this.reloadFromDisk();
      this.applyExpiration();
      this.changed = false;
      const result = await fn();
      this.persistIfChanged();
      events = this.takePendingEvents();
      return result;
    } catch (err) {
      this.pendingEvents = [];
      this.reloadFromDisk();
      throw err;
    } finally {
      this.lock.release();
      await this.emitEvents(events);
    }
  }

  private takePendingEvents(): Array<{ event: string; data: Record<string, unknown> }> {
    const batch = this.pendingEvents;
    this.pendingEvents = [];
    return batch;
  }

  private async emitEvents(
    batch: Array<{ event: string; data: Record<string, unknown> }>,
  ): Promise<void> {
    for (const { event, data } of batch) {
      await this.emitEvent(event, data);
    }
  }

  private markChanged(): void { this.changed = true; }

  // ═══ Query (refreshes from disk; no mutation lock) ═══════════

  /** Reload state from disk. For read operations that need fresh data. */
  async refresh(): Promise<void> {
    const acquired = await this.lock.acquire(2000);
    if (!acquired) return;
    try {
      this.reloadFromDisk();
      this.applyExpiration();
    } finally {
      this.lock.release();
    }
  }

  list(): OwnershipRecord[] { return [...this.records]; }

  get(id: string): OwnershipRecord | undefined { return this.records.find(r => r.id === id); }

  /** Fresh query — reloads latest snapshot from disk. */
  async listActive(): Promise<OwnershipRecord[]> {
    await this.refresh();
    return this.records.filter(r => r.status === "active" && !this.isExpired(r));
  }

  /** Fresh query — reloads latest snapshot from disk. */
  async listHistory(): Promise<OwnershipRecord[]> {
    await this.refresh();
    return this.records.filter(r => r.status !== "active" || this.isExpired(r));
  }

  /** Fresh query — returns records matching the pattern. */
  async findConflictsByPattern(pattern: string): Promise<OwnershipRecord[]> {
    await this.refresh();
    const scope = normalizePathScope(pattern, this.cwd);
    return this.records.filter(r =>
      r.status === "active" && !this.isExpired(r) &&
      r.scope.kind === "path" && pathScopesOverlap(r.scope, scope)
    );
  }

  // ═══ Public API (each internally acquires/releases lock) ═══════

  async acquire(req: AcquireRequest): Promise<AcquireResult> {
    return (await this.withLock(async () => this.acquireUnlocked(req)))
      ?? { acquired: false, conflict: { reason: "Lock acquisition timed out", conflictingRecords: [] } };
  }

  async acquireMany(reqs: AcquireRequest[]): Promise<AcquireResult[]> {
    return (await this.withLock(async () => {
      // Check against existing persisted records
      for (const r of reqs) {
        const c = this.findConflicts(r.agentId, r.scope, r.mode);
        if (!c.allowed) {
          return reqs.map(() =>
            ({ acquired: false, conflict: { reason: `Batch conflict: ${c.reason}`, conflictingRecords: c.conflictingRecords } }));
        }
      }
      // Check intra-batch conflicts (same batch, different agents, overlapping scopes)
      for (let i = 0; i < reqs.length; i++) {
        for (let j = i + 1; j < reqs.length; j++) {
          if (
            reqs[i].agentId !== reqs[j].agentId &&
            this.scopesOverlap(reqs[i].scope, reqs[j].scope) &&
            modesConflict(reqs[i].mode, reqs[j].mode)
          ) {
            return reqs.map(() =>
              ({ acquired: false, conflict: { reason: "Intra-batch conflict", conflictingRecords: [] } }));
          }
        }
      }
      return reqs.map(r => this.acquireUnlocked(r));
    })) ?? reqs.map(() => ({ acquired: false, conflict: { reason: "Lock acquisition timed out", conflictingRecords: [] } }));
  }

  async release(id: string): Promise<boolean> {
    return (await this.withLock(async () => this.releaseUnlocked(id))) ?? false;
  }

  async renew(id: string, ttlMs?: number): Promise<boolean> {
    return (await this.withLock(async () => this.renewUnlocked(id, ttlMs))) ?? false;
  }

  async revoke(id: string): Promise<boolean> {
    return (await this.withLock(async () => this.revokeUnlocked(id))) ?? false;
  }

  async prune(opts?: { olderThanDays?: number }): Promise<number> {
    return (await this.withLock(async () => this.pruneUnlocked(opts))) ?? 0;
  }

  /**
   * Authorize a mutation: under lock, reload state, check conflicts,
   * verify or acquire coverage. Single API for OwnershipGate.
   */
  async authorizeMutation(opts: {
    agentId: string;
    targets: MutationTarget[];
    autoAcquire: boolean;
  }): Promise<MutationAuthorization> {
    return (await this.withLock(async () => this.authorizeMutationUnlocked(opts)))
      ?? { allowed: false, reason: "Lock acquisition timed out" };
  }

  /** Check whether agent has active exclusive-write coverage for a path. */
  hasCoverageForPath(agentId: string, targetPath: string): boolean {
    return this.records.some(r =>
      r.status === "active" &&
      !this.isExpired(r) &&
      r.agentId === agentId &&
      r.mode === "exclusive-write" &&
      r.scope.kind === "path" &&
      scopeContains(r.scope, targetPath)
    );
  }

  // ═══ Private unlocked helpers (caller must hold lock) ═══════════

  private acquireUnlocked(req: AcquireRequest): AcquireResult {
    const conflict = this.findConflicts(req.agentId, req.scope, req.mode);
    if (!conflict.allowed) {
      this.queueEvent("ownership.denied", { agentId: req.agentId, scope: req.scope, mode: req.mode, reason: conflict.reason });
      this.queueEvent("ownership.conflict", { agentId: req.agentId, conflicting: conflict.conflictingRecords });
      return { acquired: false, conflict };
    }

    // Same agent, same scope+mode → renew
    const existing = this.findOwnExact(req.agentId, req.scope, req.mode);
    if (existing) {
      existing.acquiredAt = new Date().toISOString();
      existing.expiresAt = new Date(Date.now() + (req.ttlMs ?? DEFAULT_TTL_MS)).toISOString();
      this.markChanged();
      this.queueEvent("ownership.renewed", { recordId: existing.id, agentId: req.agentId, scope: req.scope, mode: req.mode });
      return { acquired: true, record: existing };
    }

    const now = new Date().toISOString();
    const ttl = req.ttlMs ?? DEFAULT_TTL_MS;
    const record: OwnershipRecord = {
      id: `own_${randomUUID().slice(0, 8)}`,
      agentId: req.agentId,
      taskId: req.taskId,
      sessionId: req.sessionId ?? this.sessionId,
      scope: req.scope,
      mode: req.mode,
      status: "active",
      acquiredAt: now,
      expiresAt: new Date(Date.now() + ttl).toISOString(),
      reason: req.reason,
    };
    this.records.push(record);
    this.markChanged();
    this.queueEvent("ownership.acquired", { recordId: record.id, agentId: req.agentId, scope: req.scope, mode: req.mode, ttl });
    return { acquired: true, record };
  }

  private releaseUnlocked(id: string): boolean {
    const record = this.records.find(r => r.id === id && r.status === "active");
    if (!record) return false;
    record.status = "released";
    record.releasedAt = new Date().toISOString();
    this.markChanged();
    this.queueEvent("ownership.released", { recordId: id, agentId: record.agentId });
    return true;
  }

  private renewUnlocked(id: string, ttlMs?: number): boolean {
    const record = this.records.find(r => r.id === id && r.status === "active" && !this.isExpired(r));
    if (!record) return false;
    record.expiresAt = new Date(Date.now() + (ttlMs ?? DEFAULT_TTL_MS)).toISOString();
    this.markChanged();
    this.queueEvent("ownership.renewed", { recordId: id, agentId: record.agentId });
    return true;
  }

  private revokeUnlocked(id: string): boolean {
    const record = this.records.find(r => r.id === id && r.status === "active");
    if (!record) return false;
    record.status = "revoked";
    record.revokedAt = new Date().toISOString();
    this.markChanged();
    this.queueEvent("ownership.revoked", { recordId: id, agentId: record.agentId });
    return true;
  }

  private pruneUnlocked(opts?: { olderThanDays?: number }): number {
    const cutoff = Date.now() - ((opts?.olderThanDays ?? HISTORY_RETENTION_DAYS) * 24 * 60 * 60 * 1000);
    const before = this.records.length;
    this.records = this.records.filter(r => {
      if (r.status === "active" && !this.isExpired(r)) return true;
      const t = r.expiredAt ?? r.revokedAt ?? r.releasedAt ?? r.expiresAt;
      return new Date(t).getTime() >= cutoff;
    });
    const removed = before - this.records.length;
    if (removed > 0) this.markChanged();
    return removed;
  }

  private authorizeMutationUnlocked(opts: {
    agentId: string;
    targets: MutationTarget[];
    autoAcquire: boolean;
  }): MutationAuthorization {
    const { agentId, targets, autoAcquire } = opts;

    // Phase 1: Check all targets for conflicts with other agents
    for (const t of targets) {
      const c = this.findConflictsForPath(agentId, t.path, "exclusive-write");
      if (c) {
        this.queueEvent("ownership.denied", { agentId, reason: c.reason, conflicting: c.conflictingRecords });
        return { allowed: false, reason: `Ownership conflict on ${t.path}: ${c.reason}` };
      }
    }

    // Phase 2: Verify or acquire coverage
    if (!autoAcquire) {
      // Explicit ownership required — check every target has coverage
      const uncovered = targets.filter(t => !this.hasCoverageForPath(agentId, t.path));
      if (uncovered.length > 0) {
        this.queueEvent("ownership.denied", { agentId, reason: "Explicit lease required", uncovered: uncovered.map(t => t.path) });
        return {
          allowed: false,
          reason: `Explicit ownership lease required for: ${uncovered.map(t => t.path).join(", ")}. ` +
            `Acquire a lease with the ownership CLI first.`,
        };
      }
    } else {
      // Auto-acquire mode: every target must be confident
      const unconfident = targets.filter(t => !t.confident);
      if (unconfident.length > 0) {
        this.queueEvent("ownership.denied", { agentId, reason: "Unconfident targets", unconfident: unconfident.map(t => t.path) });
        return {
          allowed: false,
          reason: `Unconfident targets cannot be auto-acquired: ${unconfident.map(t => t.path).join(", ")}`,
        };
      }
      for (const t of targets) {
        if (!this.hasCoverageForPath(agentId, t.path)) {
          this.acquireUnlocked({
            agentId,
            scope: { kind: "path", root: t.path, recursive: false },
            mode: "exclusive-write",
            reason: "auto-acquired by gate",
            ttlMs: 5 * 60 * 1000,
          });
        }
      }
    }

    return { allowed: true };
  }

  // ─── Conflict detection ────────────────────────────────────────────

  private findConflicts(
    agentId: string, scope: OwnershipScope, requestedMode: OwnershipMode,
  ): { allowed: boolean; reason: string; conflictingRecords: OwnershipRecord[] } {
    const conflicting: OwnershipRecord[] = [];
    for (const r of this.records) {
      if (r.status !== "active" || this.isExpired(r)) continue;
      if (r.agentId === agentId) continue;
      if (!this.scopesOverlap(r.scope, scope)) continue;
      if (modesConflict(r.mode, requestedMode)) conflicting.push(r);
    }
    if (conflicting.length > 0) {
      return {
        allowed: false,
        reason: `Conflicts: ${conflicting.map(c => `${c.agentId} (${c.mode} on ${formatScope(c.scope)})`).join(", ")}`,
        conflictingRecords: conflicting,
      };
    }
    return { allowed: true, reason: "No conflicts", conflictingRecords: [] };
  }

  private findConflictsForPath(
    agentId: string, targetPath: string, requestedMode: OwnershipMode,
  ): AcquireResult["conflict"] {
    const conflicting: OwnershipRecord[] = [];
    for (const r of this.records) {
      if (r.status !== "active" || this.isExpired(r)) continue;
      if (r.agentId === agentId) continue;
      if (r.scope.kind !== "path") continue;
      if (!scopeContains(r.scope, targetPath)) continue;
      if (modesConflict(r.mode, requestedMode)) conflicting.push(r);
    }
    if (conflicting.length > 0) {
      return { reason: `Conflicts: ${conflicting.map(c => `${c.agentId} (${c.mode})`).join(", ")}`, conflictingRecords: conflicting };
    }
    return undefined;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private isExpired(r: OwnershipRecord): boolean {
    return r.status === "active" && Date.now() > new Date(r.expiresAt).getTime();
  }

  private scopesEqual(a: OwnershipScope, b: OwnershipScope): boolean {
    return a.kind === b.kind && a.root === b.root && a.recursive === b.recursive;
  }

  private scopesOverlap(a: OwnershipScope, b: OwnershipScope): boolean {
    if (a.kind !== "path" || b.kind !== "path") return false;
    return pathScopesOverlap(a, b);
  }

  private findOwnExact(agentId: string, scope: OwnershipScope, mode: OwnershipMode): OwnershipRecord | undefined {
    return this.records.find(r =>
      r.status === "active" && !this.isExpired(r) &&
      r.agentId === agentId && this.scopesEqual(r.scope, scope) && r.mode === mode
    );
  }

  // ─── Events (emitted after lock release) ───────────────────────

  private queueEvent(event: string, data: Record<string, unknown>): void {
    this.pendingEvents.push({ event, data });
  }

  private async emitEvent(event: string, data: Record<string, unknown>): Promise<void> {
    if (!this.eventSink) return;
    try {
      await this.eventSink.emit(event, {
        ...data,
        revision: this.revision,
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
      });
    } catch (error) {
      // Event-write failure must not undo a committed lease
      console.error("Ownership event emission failed:", event, error);
    }
  }
}
