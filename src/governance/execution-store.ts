/**
 * P17.4 — ExecutionStore: append-only JSONL store for execution attempt records.
 *
 * One JSONL file `.alix/governance/execution-attempts.jsonl`. append() adds a
 * new record. list() returns newest-first. getById() / getByPlanId() filter
 * in-memory. getByApprovalId() finds attempts linked to a specific approval.
 *
 * Follows the P14 store pattern (async I/O, JSONL, newest-first reads).
 *
 * @module
 */

import { mkdir, readFile, appendFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GovernanceExecutionAttempt } from "./execution-recorder.js";

const ATTEMPTS_FILE = "execution-attempts.jsonl";

export class ExecutionStore {
  private dir: string;

  constructor(
    baseDir: string,
    private readonly storeSubdir?: string,
  ) {
    this.dir = storeSubdir ? join(baseDir, storeSubdir) : baseDir;
  }

  private get filePath(): string {
    return join(this.dir, ATTEMPTS_FILE);
  }

  private async ensureDir(): Promise<void> {
    try {
      await stat(this.dir);
    } catch {
      await mkdir(this.dir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Read all records, newest-first. Skips corrupt lines silently.
  // ---------------------------------------------------------------------------

  private async readAll(): Promise<GovernanceExecutionAttempt[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const lines = content.trim().split("\n").filter(Boolean);
    const results: GovernanceExecutionAttempt[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as GovernanceExecutionAttempt);
      } catch {
        // skip corrupt lines
      }
    }
    return results.reverse();
  }

  // ---------------------------------------------------------------------------
  // append — write a new attempt record (must be validated by caller)
  // ---------------------------------------------------------------------------

  async append(attempt: GovernanceExecutionAttempt): Promise<void> {
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(attempt) + "\n", "utf8");
  }

  // ---------------------------------------------------------------------------
  // list — all attempts, newest-first
  // ---------------------------------------------------------------------------

  async list(limit?: number): Promise<GovernanceExecutionAttempt[]> {
    const all = await this.readAll();
    return limit !== undefined && limit > 0 ? all.slice(0, limit) : all;
  }

  // ---------------------------------------------------------------------------
  // getById — find by attemptId
  // ---------------------------------------------------------------------------

  async getById(attemptId: string): Promise<GovernanceExecutionAttempt | null> {
    const all = await this.readAll();
    return all.find((a) => a.attemptId === attemptId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // getByPlanId — all attempts for a given plan
  // ---------------------------------------------------------------------------

  async getByPlanId(planId: string): Promise<GovernanceExecutionAttempt[]> {
    const all = await this.readAll();
    return all.filter((a) => a.planId === planId);
  }

  // ---------------------------------------------------------------------------
  // getByApprovalId — all attempts linked to a specific approval
  // ---------------------------------------------------------------------------

  async getByApprovalId(approvalId: string): Promise<GovernanceExecutionAttempt[]> {
    const all = await this.readAll();
    return all.filter((a) => a.approvalId === approvalId);
  }
}
