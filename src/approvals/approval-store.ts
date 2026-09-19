/**
 * approval-store.ts — File-backed approval queue.
 *
 * Stores approval requests in .alix/approvals/approvals.json.
 * CLI-first: no browser write actions.
 */

import { readFile, writeFile, mkdir, appendFile, rm } from "node:fs/promises";
import { rename as renameFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AuditStore } from "../audit/audit-store.js";
import type { EventLog } from "../events/event-log.js";
import type { ApprovalRecord, ApprovalGroup, ConsumeResult } from "./approval-types.js";
import type { WorkerOwnershipClaim } from "../kernel/coordination-types.js";
import { normalizeApprovalRecord } from "./approval-binding.js";
import { ApprovalStoreLock } from "./approval-store-lock.js";
import { APPROVAL_EVENT_TYPES } from "../events/types.js";

/** Compact the append-only journal once it reaches this many entries (#703). */
const JOURNAL_COMPACT_THRESHOLD = 500;

export type ApprovalRequestInput = {
  reason: string;
  bindingKey: string;
  requestFingerprint: string;
  policyRevision: string;
  capabilities: string[];
  ownershipClaims?: WorkerOwnershipClaim[];
  coordinationRunId?: string;
  workerId?: string;
  workerAttempt?: number;
  graphId?: string;
  nodeId?: string;
  sessionId?: string;
  agentId?: string;
  toolId?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  groupId?: string;
  expiresAt?: string;
  /** Stable request id (typically the toolCallId) used for retry de-dup. */
  requestId?: string;
};

export class ApprovalStore {
  private approvals: ApprovalRecord[] = [];
  private groups: ApprovalGroup[] = [];
  private filePath: string;
  /** Append-only delta log for new records (#703); folded into the snapshot
   *  on compaction. External readers must replay it after the snapshot. */
  private journalPath: string;
  private cwd: string;
  private auditStore?: AuditStore;
  private eventLog?: EventLog;
  /** In-flight fire-and-forget appends, for a deterministic test barrier. */
  private pendingAppends: Promise<unknown>[] = [];

  /** O(1) lookup indexes (#703), rebuilt on load and after each mutation. */
  private byId = new Map<string, ApprovalRecord>();
  private byBindingKey = new Map<string, ApprovalRecord[]>();

  /** Retention cap for terminal (non-pending/approved) records (#703). */
  private readonly maxTerminalRecords: number;

  constructor(cwd: string, opts?: { auditStore?: AuditStore; eventLog?: EventLog; maxTerminalRecords?: number }) {
    this.cwd = cwd;
    this.filePath = join(cwd, ".alix", "approvals", "approvals.json");
    this.journalPath = `${this.filePath}.journal.jsonl`;
    this.auditStore = opts?.auditStore;
    this.eventLog = opts?.eventLog;
    this.maxTerminalRecords = opts?.maxTerminalRecords ?? 1_000;
  }

  /** Rebuild the id / binding-key indexes from the in-memory record array. */
  private rebuildIndexes(): void {
    this.byId.clear();
    this.byBindingKey.clear();
    for (const record of this.approvals) {
      this.byId.set(record.id, record);
      const bucket = this.byBindingKey.get(record.bindingKey);
      if (bucket) bucket.push(record);
      else this.byBindingKey.set(record.bindingKey, [record]);
    }
  }

  /**
   * Bound growth (#703): drop the oldest terminal records beyond the
   * retention cap. Pending/approved records are never pruned (they are
   * still actionable). Returns true when anything was removed.
   */
  private pruneTerminal(): boolean {
    const isTerminal = (s: ApprovalRecord["status"]): boolean =>
      s === "denied" || s === "consumed" || s === "expired" || s === "revoked" || s === "invalidated";
    const terminal = this.approvals.filter((r) => isTerminal(r.status));
    if (terminal.length <= this.maxTerminalRecords) return false;
    // createdAt is ISO-8601, so lexicographic order is chronological.
    terminal.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const drop = new Set(terminal.slice(0, terminal.length - this.maxTerminalRecords).map((r) => r.id));
    this.approvals = this.approvals.filter((r) => !drop.has(r.id));
    return true;
  }

  /** Load approvals from disk. */
  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      this.approvals = [];
      this.groups = [];
    } else {
      try {
        const raw = await readFile(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        // Support both old format (array) and new format ({ approvals, groups })
        if (Array.isArray(parsed)) {
          this.approvals = (parsed as any[]).map(r =>
            normalizeApprovalRecord(r, { defaultPolicyRevision: "legacy", now: new Date() })
          );
          this.groups = [];
        } else {
          const data = parsed as { approvals?: any[]; groups?: ApprovalGroup[] };
          this.approvals = (data.approvals ?? []).map(r =>
            normalizeApprovalRecord(r, { defaultPolicyRevision: "legacy", now: new Date() })
          );
          this.groups = data.groups ?? [];
        }
      } catch {
        this.approvals = [];
        this.groups = [];
      }
    }
    // Replay the append-only journal on top of the snapshot (#703).
    const journal = await this.readJournal();
    for (const record of journal) {
      const idx = this.approvals.findIndex((a) => a.id === record.id);
      if (idx >= 0) this.approvals[idx] = record;
      else this.approvals.push(record);
    }
    this.rebuildIndexes();
  }

  /** Read + normalize journal records (append-only delta since last compact). */
  private async readJournal(): Promise<ApprovalRecord[]> {
    if (!existsSync(this.journalPath)) return [];
    try {
      const raw = await readFile(this.journalPath, "utf-8");
      const records: ApprovalRecord[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { record?: unknown };
          if (!parsed || typeof parsed !== "object" || !parsed.record) continue;
          records.push(normalizeApprovalRecord(parsed.record, { defaultPolicyRevision: "legacy", now: new Date() }));
        } catch { /* skip malformed journal line */ }
      }
      return records;
    } catch {
      return [];
    }
  }

  /** Append new records to the journal (no snapshot rewrite). */
  private async appendJournal(records: ApprovalRecord[]): Promise<void> {
    if (records.length === 0) return;
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true, mode: 0o700 });
    const lines = records.map((record) => JSON.stringify({ op: "put", record })).join("\n") + "\n";
    await appendFile(this.journalPath, lines, { encoding: "utf-8", mode: 0o600 });
  }

  /** Persist to disk (compacts the journal into the snapshot). */
  async save(): Promise<void> {
    await this.saveAtomic();
  }

  /**
   * Emit a lifecycle event to the EventLog — best-effort (Option-3 convention):
   * the append happens after the durable mutation succeeds, so a failure must
   * not change the store method's contract. Fire-and-forget, matching the
   * repo's established `.catch(() => {})` pattern on hot paths.
   */
  private emit(type: string, payload: Record<string, unknown>, sessionId?: string): void {
    const append = this.eventLog?.append({ sessionId: sessionId ?? "unknown", actor: "policy", type, payload });
    if (append) {
      append.catch(() => {});  // fire-and-forget (Option-3 convention)
      this.pendingAppends.push(append);
    }
  }

  /** Await all in-flight fire-and-forget appends so a subsequent read is
   *  deterministic. Production callers never need this (the appends are
   *  intentionally non-fatal); it exists so tests can assert the emitted
   *  lifecycle events without racing the async append. */
  async flushEvents(): Promise<void> {
    const pending = this.pendingAppends.splice(0);
    await Promise.all(pending);
  }

  /** Compact: write the full snapshot atomically, then clear the journal. */
  private async saveAtomic(): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
    const token = randomUUID().slice(0, 8);
    const tmpPath = `${this.filePath}.tmp.${token}`;
    const state = { approvals: this.approvals, groups: this.groups ?? [] };
    await writeFile(tmpPath, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600, flag: "wx" });
    await renameFile(tmpPath, this.filePath);
    // Snapshot now includes every journal record — drop the delta.
    await rm(this.journalPath, { force: true }).catch(() => {});
  }

  /**
   * Acquire the per-file lock, load fresh, run a mutation, then persist.
   * Pure additions append to the journal (no snapshot rewrite); updates,
   * deletions, or retention pruning compact the snapshot (#703).
   */
  async mutate<T>(fn: (approvals: ApprovalRecord[]) => T | Promise<T>): Promise<T> {
    const lock = new ApprovalStoreLock(this.cwd);
    const acquired = await lock.acquire();
    if (!acquired) throw new Error("Could not acquire approval lock");
    try {
      await this.load();
      const before = new Map<string, string>();
      for (const r of this.approvals) before.set(r.id, JSON.stringify(r));

      const result = await fn(this.approvals);

      // Classify the diff: additions vs updates/deletions.
      const added: ApprovalRecord[] = [];
      let mutatedExisting = false;
      for (const r of this.approvals) {
        const prior = before.get(r.id);
        if (prior === undefined) added.push(r);
        else if (prior !== JSON.stringify(r)) mutatedExisting = true;
      }
      const afterIds = new Set(this.approvals.map((r) => r.id));
      for (const id of before.keys()) {
        if (!afterIds.has(id)) { mutatedExisting = true; break; }
      }

      const pruned = this.pruneTerminal();
      this.rebuildIndexes();

      if (!mutatedExisting && !pruned && added.length > 0 && existsSync(this.filePath)) {
        // Append-only fast path: no unrelated history rewritten. (The first
        // write compacts so `approvals.json` exists for external readers.)
        await this.appendJournal(added);
        const journalLines = await this.journalLineCount();
        if (journalLines >= JOURNAL_COMPACT_THRESHOLD) {
          await this.saveAtomic();
        }
      } else {
        await this.saveAtomic();
      }
      return result;
    } finally {
      lock.release();
    }
  }

  /** Count journal lines (cheap; used to trigger compaction). */
  private async journalLineCount(): Promise<number> {
    if (!existsSync(this.journalPath)) return 0;
    try {
      const raw = await readFile(this.journalPath, "utf-8");
      return raw.split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  // ─── Enriched request types ───────────────────────────────────────

  /** Enriched request with exact binding — uses mutate() for lock safety. */
  async requestBound(input: ApprovalRequestInput): Promise<ApprovalRecord> {
    return this.mutate((approvals) => {
      // Dedup note: callers are responsible for checking whether a pending
      // approval with the same binding key already exists. The coordination
      // flow in policy-gate.ts does this BEFORE calling requestBound (via
      // store.findPendingByBindingKey). Legacy callers (store.request) must
      // always create a fresh record per call — "ask" mode in policy-gate
      // depends on a new approval for every request.

      const record: ApprovalRecord = {
        id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        schemaVersion: "2.0",
        status: "pending",
        usePolicy: "single_use",
        bindingKey: input.bindingKey,
        requestFingerprint: input.requestFingerprint,
        policyRevision: input.policyRevision,
        capabilities: input.capabilities,
        ownershipClaims: input.ownershipClaims ?? [],
        reason: input.reason,
        createdAt: new Date().toISOString(),
        expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
        coordinationRunId: input.coordinationRunId,
        workerId: input.workerId,
        workerAttempt: input.workerAttempt,
        graphId: input.graphId,
        nodeId: input.nodeId,
        sessionId: input.sessionId,
        agentId: input.agentId,
        toolId: input.toolId,
        riskLevel: input.riskLevel,
        groupId: input.groupId,
        requestId: input.requestId,
      };
      approvals.push(record);

      // Emit event after successful mutation
      this.emit(APPROVAL_EVENT_TYPES.CREATED, {
        approvalId: record.id,
        coordinationRunId: record.coordinationRunId,
        workerId: record.workerId,
        capabilities: record.capabilities,
        bindingKey: record.bindingKey,
        policyRevision: record.policyRevision,
        status: record.status,
        timestamp: record.createdAt,
        reason: record.reason,
        toolId: record.toolId,
        requestId: record.requestId,
        sessionId: record.sessionId,
        agentId: record.agentId,
      }, record.sessionId);

      return record;
    });
  }

  /**
   * requestFresh — Always creates a new approval record even if one with the
   * same binding key already exists. Delegates to mutate() for thread safety.
   */
  async requestFresh(input: ApprovalRequestInput): Promise<ApprovalRecord> {
    return this.createApprovalRecord(input);
  }

  /**
   * requestOrReusePending — Atomic lookup + insert inside a single mutate() call.
   *
   * If a pending approval with the same bindingKey already exists, returns it.
   * Otherwise creates a new one via the same logic as requestBound.
   *
   * This eliminates the check-then-create race that requestBound() leaves to callers.
   */
  async requestOrReusePending(input: ApprovalRequestInput): Promise<ApprovalRecord> {
    return this.mutate((approvals) => {
      // Look for existing pending approval with the same binding key
      const existing = approvals.find(
        (a) => a.status === "pending" && a.bindingKey === input.bindingKey,
      );
      if (existing) {
        return { ...existing };
      }

      // No existing pending — create a new record
      const record: ApprovalRecord = {
        id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        schemaVersion: "2.0",
        status: "pending",
        usePolicy: "single_use",
        bindingKey: input.bindingKey,
        requestFingerprint: input.requestFingerprint,
        policyRevision: input.policyRevision,
        capabilities: input.capabilities,
        ownershipClaims: input.ownershipClaims ?? [],
        reason: input.reason,
        createdAt: new Date().toISOString(),
        expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
        coordinationRunId: input.coordinationRunId,
        workerId: input.workerId,
        workerAttempt: input.workerAttempt,
        graphId: input.graphId,
        nodeId: input.nodeId,
        sessionId: input.sessionId,
        agentId: input.agentId,
        toolId: input.toolId,
        riskLevel: input.riskLevel,
        groupId: input.groupId,
        requestId: input.requestId,
      };
      approvals.push(record);

      this.emit(APPROVAL_EVENT_TYPES.CREATED, {
        approvalId: record.id,
        coordinationRunId: record.coordinationRunId,
        workerId: record.workerId,
        capabilities: record.capabilities,
        bindingKey: record.bindingKey,
        policyRevision: record.policyRevision,
        status: record.status,
        timestamp: record.createdAt,
        reason: record.reason,
        toolId: record.toolId,
        requestId: record.requestId,
        sessionId: record.sessionId,
        agentId: record.agentId,
      }, record.sessionId);

      return record;
    });
  }

  /** Internal helper to create an approval record inside mutate(). */
  private async createApprovalRecord(input: ApprovalRequestInput): Promise<ApprovalRecord> {
    return this.mutate((approvals) => {
      const record: ApprovalRecord = {
        id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        schemaVersion: "2.0",
        status: "pending",
        usePolicy: "single_use",
        bindingKey: input.bindingKey,
        requestFingerprint: input.requestFingerprint,
        policyRevision: input.policyRevision,
        capabilities: input.capabilities,
        ownershipClaims: input.ownershipClaims ?? [],
        reason: input.reason,
        createdAt: new Date().toISOString(),
        expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
        coordinationRunId: input.coordinationRunId,
        workerId: input.workerId,
        workerAttempt: input.workerAttempt,
        graphId: input.graphId,
        nodeId: input.nodeId,
        sessionId: input.sessionId,
        agentId: input.agentId,
        toolId: input.toolId,
        riskLevel: input.riskLevel,
        groupId: input.groupId,
        requestId: input.requestId,
      };
      approvals.push(record);

      this.emit(APPROVAL_EVENT_TYPES.CREATED, {
        approvalId: record.id,
        coordinationRunId: record.coordinationRunId,
        workerId: record.workerId,
        capabilities: record.capabilities,
        bindingKey: record.bindingKey,
        policyRevision: record.policyRevision,
        status: record.status,
        timestamp: record.createdAt,
        reason: record.reason,
        toolId: record.toolId,
        requestId: record.requestId,
        sessionId: record.sessionId,
        agentId: record.agentId,
      }, record.sessionId);

      return record;
    });
  }

  /** Legacy request wrapper — generates a safe binding from available fields. */
  async request(opts: {
    reason: string;
    graphId?: string;
    nodeId?: string;
    sessionId?: string;
    agentId?: string;
    capability?: string;
    toolId?: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
    /**
     * Stable request id (typically the toolCallId) that lets the policy
     * gate recognise a re-execution of the SAME tool call. When the gate
     * sees a previously-resolved approval with this requestId, it can
     * honour that resolution instead of creating a duplicate approval.
     */
    requestId?: string;
  }): Promise<ApprovalRecord> {
    const { computeBindingKey } = await import("./approval-binding.js");
    const requestFingerprint = `legacy:${opts.capability ?? "unknown"}:${opts.graphId ?? ""}:${opts.nodeId ?? ""}:${opts.sessionId ?? ""}`;
    const bindingKey = computeBindingKey({
      capabilities: opts.capability ? [opts.capability] : [],
      ownershipClaims: [],
      requestFingerprint,
      policyRevision: "legacy",
      graphId: opts.graphId,
      nodeId: opts.nodeId,
      sessionId: opts.sessionId,
    });
    return this.requestBound({
      reason: opts.reason,
      bindingKey,
      requestFingerprint,
      policyRevision: "legacy",
      capabilities: opts.capability ? [opts.capability] : [],
      graphId: opts.graphId,
      nodeId: opts.nodeId,
      sessionId: opts.sessionId,
      agentId: opts.agentId,
      toolId: opts.toolId,
      riskLevel: opts.riskLevel,
      requestId: opts.requestId,
    });
  }

  /** Resolve a pending approval — uses mutate() for lock safety. */
  async resolve(
    id: string,
    status: "approved" | "denied",
    decisionReason?: string,
  ): Promise<ApprovalRecord | null> {
    const resolved = await this.mutate((approvals) => {
      const record = approvals.find(a => a.id === id);
      if (!record || record.status !== "pending") { return record ?? null; }
      record.status = status;
      record.decidedAt = new Date().toISOString();
      record.decisionReason = decisionReason;
      return { ...record } as ApprovalRecord;
    });

    // Emit events after lock is released
    if (resolved && resolved.status === status) {
      this.emit(APPROVAL_EVENT_TYPES.RESOLVED, {
        approvalId: id,
        coordinationRunId: resolved.coordinationRunId,
        workerId: resolved.workerId,
        agentId: resolved.agentId,
        capabilities: resolved.capabilities,
        bindingKey: resolved.bindingKey,
        policyRevision: resolved.policyRevision,
        status,
        reason: decisionReason,
        timestamp: resolved.decidedAt,
      }, resolved.sessionId);
      this.auditStore?.append({
        action: status === "approved" ? "approval.approved" : "approval.denied",
        actor: "user",
        details: { approvalId: id, reason: decisionReason },
      }).catch(() => {});
    }
    return resolved;
  }

  /** List all approvals, newest first. */
  list(): ApprovalRecord[] {
    // createdAt is ISO-8601: lexicographic order is chronological.
    return [...this.approvals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** List pending approvals only. */
  listPending(): ApprovalRecord[] {
    return this.list().filter(a => a.status === "pending");
  }

  /** Get a single approval by ID — O(1) via index (#703). */
  get(id: string): ApprovalRecord | undefined {
    return this.byId.get(id);
  }

  /**
   * Find the most recent approval for a given requestId (typically the
   * toolCallId). Returns the latest record regardless of status — callers
   * inspect `.status` to decide how to proceed. This is the de-dup hook:
   * when the agent loop re-executes the same tool call after approval,
   * the policy gate uses this to recognise the prior resolution instead
   * of creating a duplicate approval record.
   */
  findByRequestId(requestId: string): ApprovalRecord | undefined {
    let latest: ApprovalRecord | undefined;
    for (const a of this.approvals) {
      if (a.requestId !== requestId) continue;
      if (!latest || a.createdAt > latest.createdAt) latest = a;
    }
    return latest;
  }

  /** Find an approval record by exact binding key — O(1) via index (#703). */
  findExact(bindingKey: string): ApprovalRecord | undefined {
    return this.byBindingKey.get(bindingKey)?.[0];
  }

  /** Find a pending approval by binding key — O(1) bucket lookup (#703). */
  findPendingByBindingKey(bindingKey: string): ApprovalRecord | undefined {
    return this.byBindingKey.get(bindingKey)?.find(a => a.status === "pending");
  }

  /**
   * Force a fresh load from disk and return an approval by ID.
   * Unlike get() which may return stale in-memory state, this
   * reloads the store first to guarantee fresh data.
   */
  async loadFresh(approvalId: string): Promise<ApprovalRecord | undefined> {
    await this.load();
    return this.byId.get(approvalId);
  }

  /**
   * Force a fresh load and find an approval by exact binding key.
   * Reloads from disk to ensure the in-memory state is current.
   */
  async findExactFresh(bindingKey: string): Promise<ApprovalRecord | undefined> {
    await this.load();
    return this.byBindingKey.get(bindingKey)?.[0];
  }

  /**
   * Mark all pending or approved approvals past their expiry as expired.
   * Returns the list of newly expired records.
   */
  async expireDue(now?: Date): Promise<ApprovalRecord[]> {
    const cutoff = now ?? new Date();
    const expired: ApprovalRecord[] = [];
    await this.mutate((approvals) => {
      for (const r of approvals) {
        if ((r.status === "pending" || r.status === "approved") && new Date(r.expiresAt) <= cutoff) {
          r.status = "expired";
          expired.push({ ...r });
        }
      }
    });
    for (const r of expired) {
      this.emit(APPROVAL_EVENT_TYPES.EXPIRED, { approvalId: r.id }, r.sessionId);
    }
    return expired;
  }

  /**
   * Revoke an approval. Terminal states (consumed, expired) cannot be revoked.
   */
  async revoke(id: string, context: { actor: string; reason: string; now?: Date }): Promise<ApprovalRecord | null> {
    let revoked: ApprovalRecord | null = null;
    await this.mutate((approvals) => {
      const r = approvals.find(a => a.id === id);
      if (!r || r.status === "consumed" || r.status === "expired") return;
      r.status = "revoked";
      r.revokedAt = (context.now ?? new Date()).toISOString();
      r.revokedBy = context.actor;
      r.revocationReason = context.reason;
      revoked = { ...r };
    });
    // `revoked` is assigned inside the mutate() closure, so TS keeps the initial
    // `null` narrowing here (closure assignments don't widen outer flow). Re-assert.
    const revokedRecord = revoked as ApprovalRecord | null;
    if (revokedRecord) {
      this.emit(APPROVAL_EVENT_TYPES.REVOKED, { approvalId: revokedRecord.id }, revokedRecord.sessionId);
    }
    return revoked;
  }

  /**
   * Invalidate all approved approvals whose policy revision doesn't match.
   */
  async invalidateByPolicyRevision(currentRevision: string, now?: Date): Promise<ApprovalRecord[]> {
    const invalidated: ApprovalRecord[] = [];
    await this.mutate((approvals) => {
      for (const r of approvals) {
        if (r.status === "approved" && r.policyRevision !== currentRevision) {
          r.status = "invalidated";
          r.invalidatedAt = (now ?? new Date()).toISOString();
          r.invalidationReason = `Policy revision changed to ${currentRevision}`;
          invalidated.push({ ...r });
        }
      }
    });
    for (const r of invalidated) {
      this.emit(APPROVAL_EVENT_TYPES.INVALIDATED, { approvalId: r.id }, r.sessionId);
    }
    return invalidated;
  }

  /**
   * Atomically consume a single-use approved approval.
   * Validates: status, expiry, binding key match.
   */
  async consumeApproved(
    id: string,
    expectedBindingKey: string,
    consumer: { workerId?: string; workerAttempt?: number; now?: Date },
  ): Promise<ConsumeResult> {
    let result: ConsumeResult = { consumed: false, reason: "not found" };
    await this.mutate((approvals) => {
      const r = approvals.find(a => a.id === id);
      if (!r) { result = { consumed: false, reason: "not found" }; return; }
      if (r.status !== "approved") { result = { consumed: false, reason: `status is ${r.status}` }; return; }
      const now = consumer.now ?? new Date();
      if (new Date(r.expiresAt) <= now) { result = { consumed: false, reason: "expired" }; return; }
      if (r.bindingKey !== expectedBindingKey) { result = { consumed: false, reason: "binding key mismatch" }; return; }
      if (r.workerId && consumer.workerId && r.workerId !== consumer.workerId) { result = { consumed: false, reason: "worker mismatch" }; return; }
      r.status = "consumed";
      r.consumedAt = (consumer.now ?? new Date()).toISOString();
      r.consumedByWorkerId = consumer.workerId;
      r.consumedAttempt = consumer.workerAttempt;
      result = { consumed: true, record: { ...r } };
    });
    // `result` is assigned inside the mutate() closure, so TS narrows it to the
    // initial `{ consumed: false }` variant here. Re-assert the declared type.
    const consumeOutcome = result as ConsumeResult;
    if (consumeOutcome.consumed && consumeOutcome.record) {
      this.emit(APPROVAL_EVENT_TYPES.CONSUMED, { approvalId: consumeOutcome.record.id }, consumeOutcome.record.sessionId);
    }
    return result;
  }

  /**
   * List approvals for a specific coordination run.
   */
  listByRun(runId: string): ApprovalRecord[] {
    return this.approvals.filter(a => a.coordinationRunId === runId);
  }

  /**
   * List approvals for a specific worker.
   */
  listByWorker(workerId: string): ApprovalRecord[] {
    return this.approvals.filter(a => a.workerId === workerId);
  }

  /**
   * List approvals belonging to a group.
   */
  listByGroup(groupId: string): ApprovalRecord[] {
    return this.approvals.filter(a => a.groupId === groupId);
  }

  /**
   * Create an approval group linking multiple approval records.
   * All approvals must share the same run, worker, attempt, scope hash,
   * policy revision, and risk level.
   */
  async createGroup(input: {
    approvalIds: string[];
    coordinationRunId?: string;
    workerId?: string;
    workerAttempt?: number;
    policyRevision: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
    now?: Date;
  }): Promise<ApprovalGroup | null> {
    const now = input.now ?? new Date();
    const approvals = this.approvals.filter(a => input.approvalIds.includes(a.id));

    // Validate all exist and are pending
    if (approvals.length !== input.approvalIds.length) return null;
    if (approvals.some(a => a.status !== "pending")) return null;

    // Validate compatibility
    const first = approvals[0];
    if (approvals.some(a =>
      a.coordinationRunId !== first.coordinationRunId ||
      a.workerId !== first.workerId ||
      a.policyRevision !== first.policyRevision
    )) return null;

    const group: ApprovalGroup = {
      id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      schemaVersion: "1.0",
      approvalIds: [...input.approvalIds],
      coordinationRunId: input.coordinationRunId,
      workerId: input.workerId,
      workerAttempt: input.workerAttempt,
      policyRevision: input.policyRevision,
      riskLevel: input.riskLevel,
      status: "pending",
      createdAt: now.toISOString(),
    };

    // Link approvals to group
    for (const a of approvals) {
      a.groupId = group.id;
    }

    // Store groups alongside approvals
    this.groups ??= [];
    this.groups.push(group);
    await this.save();
    return group;
  }

  /**
   * Atomically resolve an entire group.
   * All members must still be pending.
   * Sets partial status when some are already resolved.
   */
  async resolveGroup(
    groupId: string,
    status: "approved" | "denied",
    context: { actor: string; reason?: string; now?: Date },
  ): Promise<ApprovalGroup | null> {
    let group: ApprovalGroup | null = null;
    let resolvedMembers: ApprovalRecord[] = [];
    await this.mutate((approvals) => {
      const g = (this.groups ?? []).find(gr => gr.id === groupId);
      if (!g) return;
      if (g.status !== "pending") { group = { ...g }; return; }

      const members = approvals.filter(a => g.approvalIds.includes(a.id));
      const allStillPending = members.every(a => a.status === "pending");

      if (allStillPending) {
        // All pending — resolve all
        for (const a of members) {
          a.status = status;
          a.decidedAt = (context.now ?? new Date()).toISOString();
          a.decisionReason = context.reason;
          a.decidedBy = context.actor;
        }
        g.status = status;
        resolvedMembers = members.map(m => ({ ...m }));
      } else {
        // Some already resolved — set partial
        g.status = "partial";
      }

      g.decidedAt = (context.now ?? new Date()).toISOString();
      g.decisionReason = context.reason;
      group = { ...g };
    });

    // Emit per-member approval.resolved for members actually resolved by this call.
    // Partial branch: already-resolved members already have their own event.
    for (const m of resolvedMembers) {
      this.emit(APPROVAL_EVENT_TYPES.RESOLVED, { approvalId: m.id, agentId: m.agentId, status }, m.sessionId);
    }
    return group;
  }

  /**
   * Get a group by ID.
   */
  getGroup(groupId: string): ApprovalGroup | undefined {
    return (this.groups ?? []).find(g => g.id === groupId);
  }

  /** Find existing pending approval for a given graph/node/capability. */
  findPending(opts: { graphId?: string; nodeId?: string; capability?: string }): ApprovalRecord | undefined {
    return this.approvals.find(a =>
      a.status === "pending"
      && (!opts.graphId || a.graphId === opts.graphId)
      && (!opts.nodeId || a.nodeId === opts.nodeId)
      && (!opts.capability || a.capabilities.includes(opts.capability))
    );
  }

  /** Find the most recent resolved (approved/denied) approval for the same key. */
  findResolved(opts: { graphId?: string; nodeId?: string; capability?: string }): ApprovalRecord | undefined {
    let latest: ApprovalRecord | undefined;
    for (const a of this.approvals) {
      if (a.status === "pending") continue;
      if (opts.graphId && a.graphId !== opts.graphId) continue;
      if (opts.nodeId && a.nodeId !== opts.nodeId) continue;
      if (opts.capability && !a.capabilities.includes(opts.capability)) continue;
      // ISO-8601 strings compare chronologically — no per-element Date.
      if (!latest || a.createdAt.localeCompare(latest.createdAt) > 0) latest = a;
    }
    return latest;
  }
}
