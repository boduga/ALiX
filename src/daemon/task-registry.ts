/**
 * task-registry.ts — File-backed daemon task registry.
 *
 * Stores task records at .alix/daemon-tasks.json with atomic writes.
 * Keeps at most 100 completed/failed/cancelled tasks.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type DaemonTaskStatus =
  | "queued" | "running" | "completed" | "failed"
  | "cancel_requested" | "cancelled";

export type DaemonTaskRecord = {
  id: string;
  task: string;
  status: DaemonTaskStatus;
  sessionId?: string;
  queuePosition?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  updatedAt: string;
  error?: string;
};

export class TaskRegistry {
  private tasks: DaemonTaskRecord[] = [];
  private filePath: string;
  private maxCompleted = 100;

  constructor(cwd: string) {
    this.filePath = join(cwd, ".alix", "daemon-tasks.json");
  }

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) { this.tasks = []; return; }
    try {
      this.tasks = JSON.parse(await readFile(this.filePath, "utf-8"));
    } catch { this.tasks = []; }
  }

  private async save(): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const tmp = this.filePath + ".tmp";
    await writeFile(tmp, JSON.stringify(this.tasks, null, 2), "utf-8");
    await rename(tmp, this.filePath);
  }

  create(task: string): DaemonTaskRecord {
    const record: DaemonTaskRecord = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      task, status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.push(record);
    this.pruneCompleted();
    this.save().catch(() => {});
    return record;
  }

  update(id: string, changes: Partial<DaemonTaskRecord>): DaemonTaskRecord | null {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx < 0) return null;
    this.tasks[idx] = { ...this.tasks[idx], ...changes, updatedAt: new Date().toISOString() };
    this.save().catch(() => {});
    return this.tasks[idx];
  }

  get(id: string): DaemonTaskRecord | undefined {
    return this.tasks.find(t => t.id === id);
  }

  list(): DaemonTaskRecord[] {
    return [...this.tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  findQueued(id: string): DaemonTaskRecord | undefined {
    return this.tasks.find(t => t.id === id && t.status === "queued");
  }

  private pruneCompleted(): void {
    const completed = this.tasks.filter(t =>
      t.status === "completed" || t.status === "failed" || t.status === "cancelled"
    );
    if (completed.length <= this.maxCompleted) return;
    const toRemove = completed.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, completed.length - this.maxCompleted);
    const removeIds = new Set(toRemove.map(t => t.id));
    this.tasks = this.tasks.filter(t => !removeIds.has(t.id));
  }
}
