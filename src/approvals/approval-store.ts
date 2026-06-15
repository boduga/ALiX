/**
 * approval-store.ts — File-backed approval queue.
 *
 * Stores approval requests in .alix/approvals/approvals.json.
 * CLI-first: no browser write actions.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { AuditStore } from "../audit/audit-store.js";
import type { EventLog } from "../events/event-log.js";
import type { ApprovalStatus, ApprovalRecord } from "./approval-types.js";
import { normalizeApprovalRecord } from "./approval-binding.js";

export class ApprovalStore {
  private approvals: ApprovalRecord[] = [];
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
      this.dirty = false;
      return;
    }
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.approvals = (JSON.parse(raw) as any[]).map(r =>
        normalizeApprovalRecord(r, { defaultPolicyRevision: "legacy", now: new Date() })
      );
      this.dirty = false;
    } catch {
      this.approvals = [];
      this.dirty = false;
    }
  }

  /** Persist to disk if dirty. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.filePath, JSON.stringify(this.approvals, null, 2), "utf-8");
    this.dirty = false;
  }

  /** Create a new pending approval request. */
  async request(opts: {
    reason: string;
    graphId?: string;
    nodeId?: string;
    sessionId?: string;
    capability?: string;
    toolId?: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
  }): Promise<ApprovalRecord> {
    const record: ApprovalRecord = {
      id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      schemaVersion: "2.0",
      status: "pending",
      usePolicy: "single_use",
      bindingKey: "",
      requestFingerprint: "",
      policyRevision: "",
      capabilities: opts.capability ? [opts.capability] : [],
      ownershipClaims: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      reason: opts.reason,
      graphId: opts.graphId,
      nodeId: opts.nodeId,
      sessionId: opts.sessionId,
      toolId: opts.toolId,
      riskLevel: opts.riskLevel,
    };
    this.approvals.push(record);
    this.dirty = true;
    await this.save();
    this.auditStore?.append({ action: "approval.created", actor: "policy", details: {
      approvalId: record.id, graphId: opts.graphId, nodeId: opts.nodeId,
      capability: opts.capability, reason: opts.reason,
    }}).catch(() => {});
    return record;
  }

  /** Resolve a pending approval. */
  async resolve(
    id: string,
    status: "approved" | "denied",
    decisionReason?: string,
  ): Promise<ApprovalRecord | null> {
    const record = this.approvals.find(a => a.id === id);
    if (!record) return null;
    if (record.status !== "pending") return record; // already resolved
    record.status = status;
    record.decidedAt = new Date().toISOString();
    record.decisionReason = decisionReason;

    // Emit approval.resolved event
    if (this.eventLog) {
      await this.eventLog.append({
        sessionId: record.sessionId ?? "unknown",
        actor: "policy",
        type: "approval.resolved",
        payload: {
          approvalId: id,
          capabilities: record.capabilities,
          sessionId: record.sessionId,
          status: status === "approved" ? ("approved" as const) : ("denied" as const),
          reason: decisionReason,
        },
      }).catch(() => {});
    }

    this.auditStore?.append({
      action: status === "approved" ? "approval.approved" : "approval.denied",
      actor: "user",
      details: { approvalId: id, reason: decisionReason },
    }).catch(() => {});
    this.dirty = true;
    await this.save();
    return record;
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
