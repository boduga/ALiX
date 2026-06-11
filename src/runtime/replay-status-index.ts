/**
 * replay-status-index.ts — Global index of replay lifecycle statuses.
 *
 * Persisted at .alix/replays/index.json.
 * Provides a single source of truth for whether a replay has been
 * captured, rolled back, or is in progress.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

export type ReplayStatus =
  | "capturing"
  | "completed"
  | "rollback-dry-run"
  | "rollback-running"
  | "rollback-completed"
  | "rollback-partial"
  | "locked";

export type ReplayStatusEntry = {
  replayId: string;
  status: ReplayStatus;
  createdAt: string;
  updatedAt: string;
  replayMode?: string;
};

export type ReplayStatusIndexData = {
  entries: ReplayStatusEntry[];
};

export class ReplayStatusIndex {
  constructor(private cwd: string) {}

  private indexPath(): string {
    return join(this.cwd, ".alix", "replays", "index.json");
  }

  async load(): Promise<ReplayStatusIndexData> {
    const path = this.indexPath();
    if (!existsSync(path)) return { entries: [] };
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ReplayStatusIndexData;
    } catch {
      return { entries: [] };
    }
  }

  async save(data: ReplayStatusIndexData): Promise<void> {
    const path = this.indexPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  }

  async getEntry(replayId: string): Promise<ReplayStatusEntry | undefined> {
    const data = await this.load();
    return data.entries.find(e => e.replayId === replayId);
  }

  async getStatus(replayId: string): Promise<ReplayStatus | undefined> {
    const entry = await this.getEntry(replayId);
    return entry?.status;
  }

  async getAll(): Promise<ReplayStatusEntry[]> {
    const data = await this.load();
    return data.entries;
  }

  async setStatus(replayId: string, status: ReplayStatus, mode?: string): Promise<void> {
    const data = await this.load();
    const existing = data.entries.find(e => e.replayId === replayId);
    const now = new Date().toISOString();
    if (existing) {
      existing.status = status;
      existing.updatedAt = now;
      if (mode) existing.replayMode = mode;
    } else {
      data.entries.push({
        replayId,
        status,
        createdAt: now,
        updatedAt: now,
        replayMode: mode,
      });
    }
    await this.save(data);
  }

  async ensureReplay(replayId: string, mode?: string): Promise<void> {
    const existing = await this.getStatus(replayId);
    if (!existing) {
      await this.setStatus(replayId, "capturing", mode);
    }
  }
}
