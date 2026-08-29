/**
 * P17.3 — ExecutionApprovalStore: append-only JSONL store for GovernanceExecutionApproval records.
 *
 * One JSONL file `.alix/governance/execution-approvals.jsonl`. save() appends a
 * new record — never rewrites in place. get()/list() resolve the latest version
 * per approvalId (last-wins within ascending line order), matching the
 * InvestigationStore pattern.
 *
 * Follows P17.0/P14 store conventions: default dir `.alix/governance/`,
 * async I/O, corrupt lines skipped.
 *
 * @module
 */

import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GovernanceExecutionApproval } from "./execution-approval.js";

const APPROVALS_FILE = "execution-approvals.jsonl";

export class ExecutionApprovalStore {
  private readonly dir: string;

  constructor(baseDir: string = process.cwd()) {
    this.dir = join(baseDir, ".alix", "governance");
  }

  private get filePath(): string {
    return join(this.dir, APPROVALS_FILE);
  }

  private async ensureDir(): Promise<void> {
    try {
      await stat(this.dir);
    } catch {
      await mkdir(this.dir, { recursive: true });
    }
  }

  private async readAll(): Promise<GovernanceExecutionApproval[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const lines = content.trim().split("\n").filter(Boolean);
    const results: GovernanceExecutionApproval[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as GovernanceExecutionApproval);
      } catch {
        // skip corrupt lines
      }
    }
    return results;
  }

  private resolveLatest(
    records: GovernanceExecutionApproval[],
  ): Map<string, GovernanceExecutionApproval> {
    const map = new Map<string, GovernanceExecutionApproval>();
    for (const r of records) {
      map.set(r.approvalId, r);
    }
    return map;
  }

  async append(approval: GovernanceExecutionApproval): Promise<void> {
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(approval) + "\n", "utf8");
  }

  async get(approvalId: string): Promise<GovernanceExecutionApproval | null> {
    const all = await this.readAll();
    return this.resolveLatest(all).get(approvalId) ?? null;
  }

  async list(): Promise<GovernanceExecutionApproval[]> {
    const all = await this.readAll();
    const latest = Array.from(this.resolveLatest(all).values());
    latest.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return latest;
  }

  async getByPlanId(
    planId: string,
  ): Promise<GovernanceExecutionApproval | null> {
    const all = await this.readAll();
    const latest = this.resolveLatest(all);
    const matches = Array.from(latest.values()).filter(
      (a) => a.planId === planId,
    );
    if (matches.length === 0) return null;
    matches.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return matches[0] ?? null;
  }
}
