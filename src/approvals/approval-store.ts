/**
 * approval-store.ts — File-backed approval queue.
 *
 * Stores approval requests in .alix/approvals/approvals.json.
 * CLI-first: no browser write actions.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type ApprovalStatus = "pending" | "approved" | "denied";

export interface ApprovalRecord {
  id: string;
  graphId?: string;
  nodeId?: string;
  sessionId?: string;
  capability?: string;
  toolId?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decisionReason?: string;
}

export class ApprovalStore {
  private approvals: ApprovalRecord[] = [];
  private dirty = false;
  private filePath: string;

  constructor(cwd: string) {
    this.filePath = join(cwd, ".alix", "approvals", "approvals.json");
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
      this.approvals = JSON.parse(raw);
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
      status: "pending",
      createdAt: new Date().toISOString(),
      reason: opts.reason,
      graphId: opts.graphId,
      nodeId: opts.nodeId,
      sessionId: opts.sessionId,
      capability: opts.capability,
      toolId: opts.toolId,
      riskLevel: opts.riskLevel,
    };
    this.approvals.push(record);
    this.dirty = true;
    await this.save();
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
}
