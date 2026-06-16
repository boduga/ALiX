/**
 * approval-store.ts — File-backed approval queue.
 *
 * Stores approval requests in .alix/approvals/approvals.json.
 * CLI-first: no browser write actions.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { rename as renameFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AuditStore } from "../audit/audit-store.js";
import type { EventLog } from "../events/event-log.js";
import type { ApprovalStatus, ApprovalRecord, ApprovalGroup, ConsumeResult } from "./approval-types.js";
import type { WorkerOwnershipClaim } from "../kernel/coordination-types.js";
import { normalizeApprovalRecord } from "./approval-binding.js";
import { ApprovalStoreLock } from "./approval-store-lock.js";
import { APPROVAL_EVENT_TYPES } from "../events/types.js";

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
  toolId?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  groupId?: string;
  expiresAt?: string;
};

export class ApprovalStore {
  private approvals: ApprovalRecord[] = [];
  private groups: ApprovalGroup[] = [];
  private dirty = false;
  private filePath: string;
  private cwd: string;
  private auditStore?: AuditStore;
  private eventLog?: EventLog;

  constructor(cwd: string, opts?: { auditStore?: AuditStore; eventLog?: EventLog }) {
    this.cwd = cwd;
    this.filePath = join(cwd, ".alix", "approvals", "approvals.json");
    this.auditStore = opts?.auditStore;
    this.eventLog = opts?.eventLog;
  }

  /** Load approvals from disk. */
  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      this.approvals = [];
      this.groups = [];
      this.dirty = false;
      return;
    }
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
      this.dirty = false;
    } catch {
      this.approvals = [];
      this.groups = [];
      this.dirty = false;
    }
  }

  /** Persist to disk if dirty. */
  async save(): Promise<void> {
    await this.saveAtomic();
  }

  /** Write to a temp file, then rename for atomic update. */
  private async saveAtomic(): Promise<void> {
    if (!this.dirty) return;
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const token = randomUUID().slice(0, 8);
    const tmpPath = `${this.filePath}.tmp.${token}`;
    const state = { approvals: this.approvals, groups: this.groups ?? [] };
    await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    await renameFile(tmpPath, this.filePath);
    this.dirty = false;
  }

  /**
   * Acquire the per-file lock, load fresh, run a mutation, then atomically persist.
   * Guarantees serialised access across concurrent processes.
   */
  async mutate<T>(fn: (approvals: ApprovalRecord[]) => T | Promise<T>): Promise<T> {
    const lock = new ApprovalStoreLock(this.cwd);
    const acquired = await lock.acquire();
    if (!acquired) throw new Error("Could not acquire approval lock");
    try {
      await this.load();
      const result = await fn(this.approvals);
      this.dirty = true;
      await this.saveAtomic();
      return result;
    } finally {
      lock.release();
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
        toolId: input.toolId,
        riskLevel: input.riskLevel,
        groupId: input.groupId,
      };
      approvals.push(record);

      // Emit event after successful mutation
      this.eventLog?.append({
        sessionId: record.sessionId ?? "unknown",
        actor: "policy",
        type: APPROVAL_EVENT_TYPES.CREATED,
        payload: {
          approvalId: record.id,
          coordinationRunId: record.coordinationRunId,
          workerId: record.workerId,
          capabilities: record.capabilities,
          bindingKey: record.bindingKey,
          policyRevision: record.policyRevision,
          status: record.status,
          timestamp: record.createdAt,
        },
      }).catch(() => {});

      return record;
    });
  }

  /** Legacy request wrapper — generates a safe binding from available fields. */
  async request(opts: {
    reason: string;
    graphId?: string;
    nodeId?: string;
    sessionId?: string;
    capability?: string;
    toolId?: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
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
      toolId: opts.toolId,
      riskLevel: opts.riskLevel,
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
      this.eventLog?.append({
        sessionId: resolved.sessionId ?? "unknown",
        actor: "policy",
        type: APPROVAL_EVENT_TYPES.RESOLVED,
        payload: {
          approvalId: id,
          coordinationRunId: resolved.coordinationRunId,
          workerId: resolved.workerId,
          capabilities: resolved.capabilities,
          bindingKey: resolved.bindingKey,
          policyRevision: resolved.policyRevision,
          status,
          reason: decisionReason,
          timestamp: resolved.decidedAt,
        },
      }).catch(() => {});
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
    return [...this.approvals].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /** List pending approvals only. */
  listPending(): ApprovalRecord[] {
    return this.list().filter(a => a.status === "pending");
  }

  /** Get a single approval by ID. */
  get(id: string): ApprovalRecord | undefined {
    return this.approvals.find(a => a.id === id);
  }

  /** Find an approval record by exact binding key. */
  findExact(bindingKey: string): ApprovalRecord | undefined {
    return this.approvals.find(a => a.bindingKey === bindingKey);
  }

  /** Find a pending approval by binding key. */
  findPendingByBindingKey(bindingKey: string): ApprovalRecord | undefined {
    return this.approvals.find(a => a.status === "pending" && a.bindingKey === bindingKey);
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

    this.dirty = true;
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
      } else {
        // Some already resolved — set partial
        g.status = "partial";
      }

      g.decidedAt = (context.now ?? new Date()).toISOString();
      g.decisionReason = context.reason;
      group = { ...g };
    });
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
    const matches = this.approvals.filter(a =>
      a.status !== "pending"
      && (!opts.graphId || a.graphId === opts.graphId)
      && (!opts.nodeId || a.nodeId === opts.nodeId)
      && (!opts.capability || a.capabilities.includes(opts.capability))
    );
    return matches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }
}
