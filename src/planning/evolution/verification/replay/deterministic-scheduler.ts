// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.2 — Deterministic Scheduler.
 *
 * Schedules tasks at logical ticks and drains them in a deterministic
 * order: tick ascending, then priority descending (higher priority first),
 * then taskId lexicographic for stable tie-breaking.
 *
 * @module deterministic-scheduler
 */

import { LogicalClock } from "./logical-clock.js";

// ---------------------------------------------------------------------------
// ScheduledTask
// ---------------------------------------------------------------------------

export interface ScheduledTask {
  /** Unique task identifier within this scheduler. */
  taskId: string;
  /** Logical tick at which the task should execute. */
  tick: number;
  /** Priority — higher values execute first within a tick. */
  priority: number;
  /** The work to execute. */
  execute: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// DeterministicScheduler
// ---------------------------------------------------------------------------

/**
 * Deterministic task scheduler driven by a LogicalClock.
 *
 * Tasks are queued and executed only when drain() is called — the
 * scheduler never uses wall-clock timers. This guarantees reproducible
 * task ordering across runs.
 *
 * @invariant Tasks execute in tick-then-priority-then-taskId order.
 * @invariant Tasks scheduled for future ticks are deferred until the
 *            clock advances past their tick.
 */
export class DeterministicScheduler {
  private readonly clock: LogicalClock;
  private readonly queue: ScheduledTask[] = [];

  constructor(clock: LogicalClock) {
    this.clock = clock;
  }

  /**
   * Schedule a task for later execution.
   */
  schedule(task: ScheduledTask): void {
    this.queue.push(task);
  }

  /**
   * Process all tasks scheduled at or before the current logical tick,
   * in priority order. Returns the number of tasks executed.
   */
  async drain(): Promise<number> {
    const ready: ScheduledTask[] = [];
    const deferred: ScheduledTask[] = [];
    const currentTick = this.clock.now();

    for (const task of this.queue) {
      if (task.tick <= currentTick) {
        ready.push(task);
      } else {
        deferred.push(task);
      }
    }

    // Sort ready tasks: tick ascending, priority descending, taskId ascending
    ready.sort(compareTasks);

    // Re-populate the queue with deferred tasks only
    this.queue.length = 0;
    for (const task of deferred) {
      this.queue.push(task);
    }

    // Execute ready tasks in order
    for (const task of ready) {
      await task.execute();
    }

    return ready.length;
  }

  /**
   * Advance the clock by one tick, then drain.
   */
  async tickAndDrain(): Promise<number> {
    this.clock.tick();
    return this.drain();
  }

  /**
   * Get the number of pending (not-yet-drained) tasks.
   */
  pending(): number {
    return this.queue.length;
  }

  /**
   * Clear all pending tasks without executing them.
   */
  clear(): void {
    this.queue.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Comparator
// ---------------------------------------------------------------------------

function compareTasks(a: ScheduledTask, b: ScheduledTask): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  // Higher priority first
  if (a.priority !== b.priority) return b.priority - a.priority;
  // Stable tie-break by taskId
  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
}
