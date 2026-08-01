/**
 * runtime-collector.ts — Polls EventLog on an interval and caches a RuntimeSnapshot.
 *
 * Follows the DaemonMetricsCollector pattern:
 *   - constructor injection of real deps
 *   - start() → sample() immediately + setInterval
 *   - stop() → clearInterval
 *   - snapshot() → returns frozen cache
 *
 * Consumption is INCREMENTAL: each sample reads only events after the last
 * checkpoint cursor via `EventLog.readSince`, reconciles them into the
 * IncrementalExecutionTraceBuilder, and advances the checkpoint only after the
 * next checkpoint has been durably saved (D5 — save-as-commit-marker). The
 * checkpoint store is constructor-injected; `start()` awaits recovery
 * (initializeCheckpoint) BEFORE the first sample so recovery can never race an
 * incomplete restore (which would wrongly start from beginningCursor). No
 * `readAll()` in the poll loop.
 */

import type { EventLog, EventLogCursor } from '../events/event-log.js';
import type { AlixEvent } from '../events/types.js';
import { IncrementalExecutionTraceBuilder } from './runtime/execution-trace-builder.js';
import type { ProjectionCheckpointStore } from './runtime/projection-checkpoint-store.js';
import type {
  RuntimeSnapshot,
  WorkflowStateSnapshot,
} from './snapshot.js';

export interface RuntimeCollector {
  start(): Promise<void>;
  stop(): void;
  snapshot(): Promise<RuntimeSnapshot | null>;
}

/** In-memory projection checkpoint. cursor-object based in the runtime layer
 *  (D7); the store persists the serialized form. `committedAt` is the instant
 *  this projection became durable (D5 — the checkpoint is the durable commit
 *  marker). */
export interface ProjectionCheckpoint {
  readonly cursor: EventLogCursor;
  readonly committedAt: number;
}

export class RuntimeCollectorImpl implements RuntimeCollector {
  private cache: RuntimeSnapshot = {
    trace: [],
    workflow: null,
    totalEventCount: 0,
    lastEventAt: null,
  };
  private timer?: ReturnType<typeof setInterval>;
  private readonly eventLog: EventLog;
  private readonly checkpointStore: ProjectionCheckpointStore;
  private readonly builder = new IncrementalExecutionTraceBuilder();
  private checkpoint: ProjectionCheckpoint;
  /** Workflow-accounting input ONLY (not a second projection). Holds events
   *  since the most recent workflow.created; trimmed when a new workflow
   *  begins. Unbounded during a single active workflow by design (trimming on
   *  workflow.completed would hide the completion from computeWorkflow). */
  private recentEvents: AlixEvent[] = [];
  private totalEventCount = 0;

  constructor(eventLog: EventLog, checkpointStore: ProjectionCheckpointStore) {
    this.eventLog = eventLog;
    this.checkpointStore = checkpointStore;
    this.checkpoint = { cursor: eventLog.beginningCursor(), committedAt: Date.now() };
  }

  /** Await recovery BEFORE the first sample — the first sample must never race
   *  an incomplete initializeCheckpoint (which would start from beginningCursor
   *  and re-process already-consumed events). */
  async start(): Promise<void> {
    await this.initializeCheckpoint();
    await this.sample();
    this.timer = setInterval(() => void this.sample(), 1_000);
  }

  /** Restore the durable checkpoint, falling back to beginningCursor when the
   *  store has none, holds a malformed/unknown-version serialized cursor, or
   *  deserialization throws — in every fallback case we replay from the start. */
  private async initializeCheckpoint(): Promise<void> {
    const saved = await this.checkpointStore.load();
    if (!saved) {
      this.checkpoint = { cursor: this.eventLog.beginningCursor(), committedAt: Date.now() };
      return;
    }
    try {
      this.checkpoint = {
        cursor: this.eventLog.deserializeCursor(saved.cursor),
        committedAt: saved.committedAt,
      };
    } catch {
      this.checkpoint = { cursor: this.eventLog.beginningCursor(), committedAt: Date.now() };
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async snapshot(): Promise<RuntimeSnapshot | null> {
    return this.cache;
  }

  /**
   * Consume the EventLog incrementally via readSince. The in-memory checkpoint
   * AND the published cache advance ONLY after the next checkpoint has been
   * durably persisted (D5 — save-as-commit-marker). A save failure keeps the
   * old checkpoint + old cache; the next sample re-reads the same events
   * (idempotent builder by seq). On any failure the previous cache is preserved
   * so the dashboard never blanks.
   */
  private async sample(): Promise<void> {
    try {
      const batch = await this.eventLog.readSince(this.checkpoint.cursor);
      this.builder.update(batch.events);

      const nextCheckpoint = { cursor: batch.cursor, committedAt: Date.now() };

      // Durable commit BEFORE advancing the in-memory checkpoint or publishing
      // the snapshot (D5). Neither the checkpoint nor the cache may advance
      // unless this save succeeded.
      await this.checkpointStore.save({
        version: 1,
        cursor: this.eventLog.serializeCursor(nextCheckpoint.cursor),
        committedAt: nextCheckpoint.committedAt,
      });

      this.checkpoint = nextCheckpoint;

      // Workflow accounting: append batch events, then trim to the last
      // workflow.created boundary (computeWorkflow only needs events since then).
      this.recentEvents = this.trimToActiveWorkflow([...this.recentEvents, ...batch.events]);

      const lastEvent = batch.events[batch.events.length - 1];
      if (lastEvent) {
        // NOTE (D7 accounting): totalEventCount = highest seq seen, which
        // equals the event count because EventLog assigns contiguous seq from
        // 1 on append. This assumption holds for Phase 5; a future backend that
        // decouples seq from count must expose getEventCount() instead.
        this.totalEventCount = Math.max(this.totalEventCount, lastEvent.seq ?? 0);
      }
      this.cache = {
        trace: this.builder.snapshot(),
        workflow: computeWorkflow(this.recentEvents),
        totalEventCount: this.totalEventCount,
        lastEventAt: lastEvent ? Date.parse(lastEvent.timestamp) || Date.now() : this.cache.lastEventAt,
      };
    } catch {
      // Keep previous cache on error — dashboard never blanks; checkpoint only
      // advances after a durable save.
    }
  }

  /** Keep only the events from the most recent workflow.created onward. */
  private trimToActiveWorkflow(events: AlixEvent[]): AlixEvent[] {
    let lastCreated = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.type === 'workflow.created') { lastCreated = i; break; }
    }
    return lastCreated === -1 ? events : events.slice(lastCreated);
  }
}

/**
 * Derive the active workflow state by scanning the event log for
 * `workflow.created`, `workflow.completed`, and step-related events.
 *
 * Returns null when no workflow has been created yet, or when the most
 * recent workflow has already been completed/finalized.
 *
 * `currentStep` starts at 1 (the workflow creation itself) and increments
 * for every `tool.started` (and other step-related) event seen after
 * `workflow.created`. `totalSteps` is the cumulative step-event count so
 * the progress bar reflects work-in-progress.
 */
export function computeWorkflow(events: readonly AlixEvent[]): WorkflowStateSnapshot | null {
  // Scan from newest to oldest to locate the boundaries of the active workflow.
  let createdIdx = -1;
  let completedIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i]!.type;
    if (t === 'workflow.created' && createdIdx === -1) {
      createdIdx = i;
    } else if (t === 'workflow.completed' && completedIdx === -1) {
      completedIdx = i;
    }
    if (createdIdx !== -1 && completedIdx !== -1) break;
  }
  if (createdIdx === -1) return null;
  // A workflow.completed after the most recent workflow.created means the
  // workflow is finalized; surface no active workflow.
  if (completedIdx > createdIdx) return null;

  const created = events[createdIdx]!;
  const payload = (created.payload ?? {}) as {
    workflowId?: unknown;
    goal?: unknown;
    mode?: unknown;
  };
  const startedAt = Date.parse(created.timestamp) || Date.now();
  const rawName =
    typeof payload.goal === 'string' && payload.goal.length > 0
      ? payload.goal
      : typeof payload.mode === 'string' && payload.mode.length > 0
        ? payload.mode
        : typeof payload.workflowId === 'string' && payload.workflowId.length > 0
          ? payload.workflowId
          : 'workflow';
  const name = rawName.length > 60 ? rawName.slice(0, 60) : rawName;

  // Count step events since workflow.created so we can derive currentStep and
  // a non-decreasing totalSteps that always reflects work-in-progress.
  let toolStartedCount = 0;
  let totalStepEvents = 0;
  for (let i = createdIdx + 1; i < events.length; i++) {
    const t = events[i]!.type;
    if (t === 'tool.started') toolStartedCount++;
    if (
      t === 'tool.started' ||
      t === 'tool.completed' ||
      t === 'tool.failed' ||
      t === 'task.ready'
    ) {
      totalStepEvents++;
    }
  }

  const currentStep = 1 + toolStartedCount;
  const totalSteps = Math.max(currentStep, 1 + totalStepEvents);

  return { name, currentStep, totalSteps, startedAt };
}
