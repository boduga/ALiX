/**
 * scheduled-task-store.ts — the active-jobs registry for agent-proposed schedules.
 *
 * File-backed at ~/.alix/scheduled-tasks.json (global, like daemon-tasks.json).
 * The agent NEVER writes here: a job only appears after a human approves the
 * matching approval record, and the daemon materializes it. This store is the
 * "what is scheduled" registry; ApprovalStore is the "who approved it" gate.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFileAtomic } from "../storage/jsonl-store.js";
import type { ScheduleSpec } from "./schedule-spec.js";

export type ScheduledTaskStatus = "active" | "expired";

export type ScheduledTaskRecord = {
  id: string;
  name: string;
  /** The task text handed to the daemon (same shape as `alix submit "<task>"`). */
  task: string;
  cwd: string;
  schedule: ScheduleSpec;
  status: ScheduledTaskStatus;
  createdAt: string;
  /** The ApprovalStore record that authorized this job. */
  approvalId: string;
  approvedBy?: string;
  expiresAt: string;
  lastRunAt?: string;
  nextRunAt: string;
  runCount: number;
  sessionId?: string;
};

/** Test/ops override for the registry path. */
export function resolveScheduledTasksPath(): string {
  return process.env.ALIX_SCHEDULED_TASKS_PATH
    ?? join(homedir(), ".alix", "scheduled-tasks.json");
}

export class ScheduledTaskStore {
  private tasks: ScheduledTaskRecord[] = [];
  private readonly filePath: string;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(filePath: string = resolveScheduledTasksPath()) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const parsed = await readJsonFile<unknown>(this.filePath);
      this.tasks = Array.isArray(parsed) ? (parsed as ScheduledTaskRecord[]) : [];
    } catch {
      this.tasks = [];
    }
  }

  private async save(): Promise<void> {
    await writeJsonFileAtomic(this.filePath, this.tasks);
  }

  /** Serialized write — concurrent mutations cannot interleave. */
  private enqueueSave(): void {
    this.savePromise = this.savePromise.then(() => this.save()).catch((err) => {
      console.error("[scheduled-tasks] save failed", err);
    });
  }

  /** Await the in-flight write (deterministic tests). */
  async flush(): Promise<void> {
    await this.savePromise;
  }

  list(): ScheduledTaskRecord[] {
    return [...this.tasks].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): ScheduledTaskRecord | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  findByName(name: string): ScheduledTaskRecord | undefined {
    return this.tasks.find((t) => t.name === name);
  }

  findByApprovalId(approvalId: string): ScheduledTaskRecord | undefined {
    return this.tasks.find((t) => t.approvalId === approvalId);
  }

  /** Count of jobs that are not expired/disabled. */
  activeCount(): number {
    return this.tasks.filter((t) => t.status === "active").length;
  }

  /** Insert or replace by id. */
  upsert(record: ScheduledTaskRecord): ScheduledTaskRecord {
    const idx = this.tasks.findIndex((t) => t.id === record.id);
    if (idx >= 0) this.tasks[idx] = record;
    else this.tasks.push(record);
    this.enqueueSave();
    return record;
  }

  create(input: Omit<ScheduledTaskRecord, "id" | "createdAt" | "runCount"> & Partial<Pick<ScheduledTaskRecord, "id" | "createdAt" | "runCount">>): ScheduledTaskRecord {
    const record: ScheduledTaskRecord = {
      id: input.id ?? `sched_${Date.now()}_${randomUUID().slice(0, 8)}`,
      createdAt: input.createdAt ?? new Date().toISOString(),
      runCount: input.runCount ?? 0,
      name: input.name,
      task: input.task,
      cwd: input.cwd,
      schedule: input.schedule,
      status: input.status,
      approvalId: input.approvalId,
      ...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy } : {}),
      expiresAt: input.expiresAt,
      ...(input.lastRunAt !== undefined ? { lastRunAt: input.lastRunAt } : {}),
      nextRunAt: input.nextRunAt,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    };
    return this.upsert(record);
  }

  update(id: string, changes: Partial<ScheduledTaskRecord>): ScheduledTaskRecord | undefined {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return undefined;
    this.tasks[idx] = { ...this.tasks[idx], ...changes };
    this.enqueueSave();
    return this.tasks[idx];
  }

  remove(id: string): boolean {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    const removed = this.tasks.length !== before;
    if (removed) this.enqueueSave();
    return removed;
  }

  /** Active jobs whose nextRunAt is at or before `now`. */
  due(now: Date = new Date()): ScheduledTaskRecord[] {
    return this.list().filter(
      (t) => t.status === "active" && Date.parse(t.nextRunAt) <= now.getTime(),
    );
  }
}
