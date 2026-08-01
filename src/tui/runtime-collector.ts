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

import { EventLog, EventLogCursorError, type EventLogCursor } from '../events/event-log.js';
import type { AlixEvent } from '../events/types.js';
import { IncrementalExecutionTraceBuilder } from './runtime/execution-trace-builder.js';
import { CHECKPOINT_CONTAINER_VERSION } from './runtime/projection-checkpoint-store.js';
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
 *  marker); `0` until the first successful sample commits a real timestamp. */
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
    // Sentinel committedAt=0: nothing has been durably saved yet. The first
    // successful sample() overwrites this with a real timestamp.
    this.checkpoint = { cursor: eventLog.beginningCursor(), committedAt: 0 };
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
   *  store has none, its load() rejects (operational — disk read failure), or
   *  the serialized cursor is invalid (any of the four `EventLogCursorError`
   *  modes: malformed JSON, unsupported version, invalid payload, or a `seq`
   *  that lies beyond the current EventLog head). In every fallback case we
   *  replay from the start. The two catches are split so the invalid-cursor
   *  path is explicit (and the operational path keeps its null fallback
   *  instead of a half-restored checkpoint). */
  private async initializeCheckpoint(): Promise<void> {
    let loaded: Awaited<ReturnType<ProjectionCheckpointStore['load']>> = null;
    try { loaded = await this.checkpointStore.load(); } catch { loaded = null; }
    if (!loaded) {
      this.resetCheckpoint();
      return;
    }
    try {
      this.checkpoint = {
        cursor: this.eventLog.deserializeCursor(loaded.cursor),
        committedAt: loaded.committedAt,
      };
    } catch (err) {
      if (err instanceof EventLogCursorError) {
        // Invalid checkpoint (any of the four EventLogCursorError modes) —
        // fall back to a full replay from beginningCursor. The persisted
        // checkpoint file is left untouched; a subsequent successful sample
        // will overwrite it with a valid one.
        this.resetCheckpoint();
      } else {
        // Operational failure during deserialization (none expected today,
        // but kept for future-proofing — a future cursor backend that throws
        // a non-cursor error). Same fallback: full replay.
        this.resetCheckpoint();
      }
    }
  }

  /** Reset the in-memory checkpoint to the durable starting position. Used by
   *  every initializeCheckpoint fallback branch. */
  private resetCheckpoint(): void {
    this.checkpoint = { cursor: this.eventLog.beginningCursor(), committedAt: 0 };
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
   *
   * D5a atomic commit: build the new cache into a LOCAL first, then advance
   * checkpoint + cache on the same final step. A throw anywhere between the
   * save succeeding and the cache being assigned leaves BOTH old — so the
   * durable checkpoint and the published snapshot stay aligned. Without this
   * ordering, a throw from computeWorkflow/builder.snapshot after a successful
   * save would leave the durable checkpoint ahead of the published snapshot,
   * and the next sample would skip the window's events.
   *
   * Invalid-cursor discrimination: a `readSince` throw of `EventLogCursorError`
   * (the beyond-head case) means the persisted checkpoint's `seq` lies past
   * the current log head — we MUST reset to `beginningCursor()` or the
   * in-memory projection will keep an out-of-range cursor and skip every
   * subsequent event. We reset and return; the next sample re-reads from the
   * start. Operational failures (disk read, save rejection) take the existing
   * path: preserve the current checkpoint + cache and retry next sample.
   */
  private async sample(): Promise<void> {
    let batch;
    try {
      batch = await this.eventLog.readSince(this.checkpoint.cursor);
    } catch (err) {
      if (err instanceof EventLogCursorError) {
        // Invalid cursor (beyond-head position). Drop the persisted
        // checkpoint's seq so the next sample re-reads from beginningCursor.
        // The builder is idempotent by event seq (re-applying already-seen
        // seqs is a no-op), so we leave its accumulated state in place — a
        // truncated log may leave stale trace entries, but the rebuild on
        // the next sample will not duplicate them and will pick up any
        // events that still exist in the log. Cache stays as-is for this
        // sample; the next sample publishes the rebuilt snapshot.
        this.resetCheckpoint();
        return;
      }
      // Operational read failure — preserve the current checkpoint + cache;
      // we return early so the rest of the sample (builder update, save)
      // does not run on a half-read batch. The next sample retries the
      // read from the same cursor.
      return;
    }

    try {
      this.builder.update(batch.events);

      const nextCheckpoint = { cursor: batch.cursor, committedAt: Date.now() };

      // Durable commit BEFORE advancing the in-memory checkpoint or publishing
      // the snapshot (D5). Neither the checkpoint nor the cache may advance
      // unless this save succeeded.
      await this.checkpointStore.save({
        version: CHECKPOINT_CONTAINER_VERSION,
        cursor: this.eventLog.serializeCursor(nextCheckpoint.cursor),
        committedAt: nextCheckpoint.committedAt,
      });

      // Workflow accounting: append batch events, then trim to the last
      // workflow.created boundary (computeWorkflow only needs events since then).
      const nextRecentEvents = this.trimToActiveWorkflow([...this.recentEvents, ...batch.events]);

      const lastEvent = batch.events[batch.events.length - 1];
      let nextTotalEventCount = this.totalEventCount;
      if (lastEvent) {
        // NOTE (D7 accounting): totalEventCount = highest seq seen, which
        // equals the event count because EventLog assigns contiguous seq from
        // 1 on append. This assumption holds for Phase 5; a future backend that
        // decouples seq from count must expose getEventCount() instead.
        nextTotalEventCount = Math.max(nextTotalEventCount, lastEvent.seq ?? 0);
      }
      const nextCache: RuntimeSnapshot = {
        trace: this.builder.snapshot(),
        workflow: computeWorkflow(nextRecentEvents),
        totalEventCount: nextTotalEventCount,
        lastEventAt: lastEvent ? Date.parse(lastEvent.timestamp) || Date.now() : this.cache.lastEventAt,
      };

      // ATOMIC commit: checkpoint + cache advance together on the same step
      // (D5a — a checkpoint file never represents a projection state that has
      // not been durably published; a published snapshot never represents a
      // checkpoint position that has not been durably persisted). If anything
      // above threw, this line never executes and the catch preserves BOTH old.
      this.checkpoint = nextCheckpoint;
      this.recentEvents = nextRecentEvents;
      this.totalEventCount = nextTotalEventCount;
      this.cache = nextCache;
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
