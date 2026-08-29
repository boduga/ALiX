/**
 * P17.2 — ExecutionPlanStore: append-only JSONL store for GovernanceExecutionPlan records.
 *
 * One JSONL file `.alix/governance/execution-plans.jsonl`. save() appends a new
 * record — never rewrites in place. get()/list() resolve the latest version per
 * planId (last-wins within ascending line order), matching the InvestigationStore
 * pattern.
 *
 * Follows P17.0/P14 store conventions: default dir `.alix/governance/`,
 * async I/O, corrupt lines skipped.
 *
 * @module
 */

import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GovernanceExecutionPlan } from "./execution-plans.js";

const PLANS_FILE = "execution-plans.jsonl";

export class ExecutionPlanStore {
  private readonly dir: string;

  constructor(baseDir: string = process.cwd()) {
    this.dir = join(baseDir, ".alix", "governance");
  }

  private get filePath(): string {
    return join(this.dir, PLANS_FILE);
  }

  private async ensureDir(): Promise<void> {
    try {
      await stat(this.dir);
    } catch {
      await mkdir(this.dir, { recursive: true });
    }
  }

  private async readAll(): Promise<GovernanceExecutionPlan[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const lines = content.trim().split("\n").filter(Boolean);
    const results: GovernanceExecutionPlan[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as GovernanceExecutionPlan);
      } catch {
        // skip corrupt lines
      }
    }
    return results;
  }

  private resolveLatest(
    records: GovernanceExecutionPlan[],
  ): Map<string, GovernanceExecutionPlan> {
    const map = new Map<string, GovernanceExecutionPlan>();
    for (const r of records) {
      map.set(r.planId, r);
    }
    return map;
  }

  async append(plan: GovernanceExecutionPlan): Promise<void> {
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(plan) + "\n", "utf8");
  }

  async get(planId: string): Promise<GovernanceExecutionPlan | null> {
    const all = await this.readAll();
    return this.resolveLatest(all).get(planId) ?? null;
  }

  async list(): Promise<GovernanceExecutionPlan[]> {
    const all = await this.readAll();
    const latest = Array.from(this.resolveLatest(all).values());
    latest.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return latest;
  }

  async getByRemediationId(
    remediationId: string,
  ): Promise<GovernanceExecutionPlan | null> {
    const all = await this.readAll();
    const latest = this.resolveLatest(all);
    const matches = Array.from(latest.values()).filter(
      (p) => p.remediationId === remediationId,
    );
    if (matches.length === 0) return null;
    matches.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return matches[0] ?? null;
  }
}
