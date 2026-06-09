/**
 * audit-store.ts — Append-only JSONL audit store.
 *
 * Stores audit records at .alix/audit/audit.jsonl.
 * JSONL (newline-delimited JSON) is append-friendly and easy to tail.
 */

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { AuditRecord, AuditAction, AuditDetails } from "./audit-types.js";

export class AuditStore {
  private filePath: string;

  constructor(cwd: string) {
    this.filePath = join(cwd, ".alix", "audit", "audit.jsonl");
  }

  /** Ensure the directory exists. */
  private async ensureDir(): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  /** Append an audit record. Returns the created record with generated ID. */
  async append(opts: {
    action: AuditAction;
    actor?: string;
    details: AuditDetails;
  }): Promise<AuditRecord> {
    const record: AuditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      action: opts.action,
      timestamp: new Date().toISOString(),
      actor: opts.actor,
      details: opts.details,
    };
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf-8");
    return record;
  }

  /** Read all audit records (newest first). */
  async list(limit = 100): Promise<AuditRecord[]> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const records: AuditRecord[] = [];
    for (const line of lines) {
      try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit);
  }

  /** Filter by action. */
  async findByAction(action: AuditAction, limit = 50): Promise<AuditRecord[]> {
    const all = await this.list(limit * 10);
    return all.filter(r => r.action === action).slice(0, limit);
  }

  /** Filter by graph ID. */
  async findByGraph(graphId: string, limit = 50): Promise<AuditRecord[]> {
    const all = await this.list(limit * 10);
    return all.filter(r => r.details.graphId === graphId).slice(0, limit);
  }

  /** Filter by approval ID. */
  async findByApproval(approvalId: string, limit = 50): Promise<AuditRecord[]> {
    const all = await this.list(limit * 10);
    return all.filter(r => r.details.approvalId === approvalId).slice(0, limit);
  }
}
