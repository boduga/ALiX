/**
 * rollback-progress.ts — Per-rollback step-level progress tracking.
 *
 * Persisted at .alix/replays/<replayId>/rollback-progress.json.
 * Enables idempotent resume of partial rollback operations after
 * process crash or interruption.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────

export type RollbackProgressStatus = "running" | "partial" | "completed" | "failed";

export type RollbackProgress = {
  rollbackId: string;
  replayId: string;
  status: RollbackProgressStatus;
  lastCompletedStepIndex: number;
  completedPaths: string[];
  failedPath?: string;
  updatedAt: string;
};

// ─── RollbackProgressStore ───────────────────────────────────────────

export class RollbackProgressStore {
  constructor(private cwd: string) {}

  private progressPath(replayId: string): string {
    return join(this.cwd, ".alix", "replays", replayId, "rollback-progress.json");
  }

  async load(replayId: string): Promise<RollbackProgress | null> {
    const path = this.progressPath(replayId);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as RollbackProgress;
    } catch {
      return null;
    }
  }

  async save(progress: RollbackProgress): Promise<void> {
    const path = this.progressPath(progress.replayId);
    mkdirSync(dirname(path), { recursive: true });
    progress.updatedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(progress, null, 2), "utf-8");
  }

  async initProgress(replayId: string, rollbackId: string): Promise<RollbackProgress> {
    const progress: RollbackProgress = {
      rollbackId,
      replayId,
      status: "running",
      lastCompletedStepIndex: -1,
      completedPaths: [],
      updatedAt: new Date().toISOString(),
    };
    await this.save(progress);
    return progress;
  }

  async markStepCompleted(replayId: string, rollbackId: string, stepIndex: number, path: string): Promise<void> {
    const progress = await this.load(replayId) ?? await this.initProgress(replayId, rollbackId);
    if (!progress.completedPaths.includes(path)) {
      progress.completedPaths.push(path);
    }
    if (stepIndex > progress.lastCompletedStepIndex) {
      progress.lastCompletedStepIndex = stepIndex;
    }
    progress.status = "running";
    await this.save(progress);
  }

  async markFailed(replayId: string, rollbackId: string, path: string): Promise<void> {
    const progress = await this.load(replayId) ?? await this.initProgress(replayId, rollbackId);
    progress.status = "failed";
    progress.failedPath = path;
    await this.save(progress);
  }

  async markCompleted(replayId: string, rollbackId: string): Promise<void> {
    const progress = await this.load(replayId) ?? await this.initProgress(replayId, rollbackId);
    progress.status = "completed";
    await this.save(progress);
  }

  async getCompletedPaths(replayId: string): Promise<string[]> {
    const progress = await this.load(replayId);
    return progress?.completedPaths ?? [];
  }

  async isPathCompleted(replayId: string, path: string): Promise<boolean> {
    const paths = await this.getCompletedPaths(replayId);
    return paths.includes(path);
  }
}
