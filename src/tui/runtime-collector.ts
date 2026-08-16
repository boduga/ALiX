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
 * checkpoint cursor via `EventLog.readSince`, dispatches them to the
 * registered projections via the ProjectionRuntime, and advances the
 * checkpoint only after the next checkpoint has been durably saved
 * (D5 — save-as-commit-marker). The
 * checkpoint store is constructor-injected; `start()` awaits recovery
 * (initializeCheckpoint) BEFORE the first sample so recovery can never race an
 * incomplete restore (which would wrongly start from beginningCursor). No
 * `readAll()` in the poll loop.
 */

import { EventLog, EventLogCursorError, type EventLogCursor } from '../events/event-log.js';
import type { AlixEvent } from '../events/types.js';
import { CHECKPOINT_CONTAINER_VERSION } from './runtime/projection-checkpoint-store.js';
import type { ProjectionCheckpointStore } from './runtime/projection-checkpoint-store.js';
import type { ProjectionRuntime } from './runtime/projection-runtime.js';
import { ProjectionIds } from './runtime/projection-ids.js';
import type { ExecutionTraceEntry } from './runtime/execution-trace.js';
import type { TimelineEntry } from './runtime/timeline-builder.js';
import type { CapabilityProjectionSnapshot } from './runtime/capability-projection.js';
import type { MetricsProjectionSnapshot } from './runtime/metrics-projection.js';
import type { ContextProjectionSnapshot } from './runtime/context-projection.js';
import type { EvolutionProjectionSnapshot } from './runtime/evolution/evolution-projection-snapshot.js';
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

/** Options-object constructor (review refinement). Avoids a growing
 *  positional-arg list as future phases add projections — new projections plug
 *  in by registering on the ProjectionRuntime. The required `sessionId` is the
 *  routing dimension: every projection (trace, timeline, workflow) is scoped
 *  to it. */
export interface RuntimeCollectorOptions {
  eventLog: EventLog;
  checkpointStore: ProjectionCheckpointStore;
  /** The session this collector projects. Events from other sessions are
   *  filtered out before any builder sees them (D1/D3). */
  sessionId: string;
  /** The projection runtime this collector hosts. Holds every registered
   *  projection (timeline, trace, ...); the collector is blind to their
   *  identity — it only dispatches, snapshots, and coordinates durable
   *  state through this object. */
  projectionRuntime: ProjectionRuntime;
  /**
   * Q-C4 — optional sessionless-event relay. Each sample, the collector delivers
   * ONLY this cycle's newly-read non-session-matching events (the ones the
   * session filter would otherwise drop) to this callback. Delivered events
   * are NOT strictly `sessionId === ""` — see partitionBySession for the
   * recorded over-delivery contract; consumers type-filter defensively. The
   * collector never interprets event types — the caller decides what the
   * events mean. When absent, non-matching events are dropped as today.
   */
  sessionlessEvents?: (events: readonly AlixEvent[]) => void;
}

export class RuntimeCollectorImpl implements RuntimeCollector {
  private cache: RuntimeSnapshot;
  private timer?: ReturnType<typeof setInterval>;
  private readonly eventLog: EventLog;
  private readonly checkpointStore: ProjectionCheckpointStore;
  private readonly sessionId: string;
  private readonly projectionRuntime: ProjectionRuntime;
  private readonly sessionlessEvents?: (events: readonly AlixEvent[]) => void;
  private checkpoint: ProjectionCheckpoint;
  /** Workflow-accounting input ONLY (not a second projection). Holds events
   *  since the most recent workflow.created; trimmed when a new workflow
   *  begins. Unbounded during a single active workflow by design (trimming on
   *  workflow.completed would hide the completion from computeWorkflow).
   *  Session-filtered like every projection. */
  private recentEvents: AlixEvent[] = [];
  private totalEventCount = 0;

  constructor(opts: RuntimeCollectorOptions) {
    this.eventLog = opts.eventLog;
    this.checkpointStore = opts.checkpointStore;
    this.sessionId = opts.sessionId;
    this.projectionRuntime = opts.projectionRuntime;
    this.sessionlessEvents = opts.sessionlessEvents;
    // Sentinel committedAt=0: nothing has been durably saved yet. The first
    // successful sample() overwrites this with a real timestamp.
    this.checkpoint = { cursor: opts.eventLog.beginningCursor(), committedAt: 0 };
    this.cache = {
      trace: [],
      timeline: [],
      workflow: null,
      totalEventCount: 0,
      lastEventAt: null,
      sessionId: opts.sessionId,
      capabilities: null,
      metrics: null,
      context: null,
    };
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
      // Phase 6.5/7: restore durable projection state when present. Reads the
      // Phase-7 `projections` shape first, falling back to the legacy Phase-6.5
      // `state` shape — both are keyed by projection id. A legacy checkpoint
      // (no state) leaves builders empty and replays forward from the cursor —
      // identical to pre-6.5 behavior. Import is safe because the cursor
      // deserialized cleanly above; an invalid cursor takes the catch below
      // and rebuilds by replay instead.
      const restored = loaded.projections ?? loaded.state;
      if (restored) this.projectionRuntime.importState(restored);
    } catch (err) {
      // Invalid checkpoint (any of the four EventLogCursorError modes — the
      // cursor's `seq` lies beyond the current head, malformed JSON, unknown
      // version, invalid payload) or an operational deserialize failure (none
      // expected today, kept for future-proofing). Both fall back to a full
      // replay from beginningCursor — the branches are identical, so there is
      // no need to discriminate the EventLogCursorError here. Reset ALL
      // projections (D12) so the replay reconstructs independent, in-memory
      // projection state — persisted state is never trusted on an invalid
      // cursor. The persisted checkpoint file is left untouched; a subsequent
      // successful sample overwrites it with a valid one.
      this.projectionRuntime.resetAll();
      this.resetCheckpoint();
    }
  }

  /** Reset the in-memory checkpoint to the durable starting position. Used by
   *  every initializeCheckpoint fallback branch. A full replay from
   *  beginningCursor rebuilds the workflow-accounting window from scratch, so
   *  the recentEvents buffer and event-count watermark are cleared too —
   *  otherwise a truncated log could carry stale pre-truncation events/counts
   *  through the rebuild (D12). */
  private resetCheckpoint(): void {
    this.checkpoint = { cursor: this.eventLog.beginningCursor(), committedAt: 0 };
    this.recentEvents = [];
    this.totalEventCount = 0;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async snapshot(): Promise<RuntimeSnapshot | null> {
    return this.cache;
  }

  /**
   * Consume the EventLog incrementally via readSince. Each read yields ONE
   * batch that is dispatched to BOTH projection builders on ONE checkpoint
   * (D5): the timeline and the trace reconcile the SAME session-filtered
   * events, so the two projections always advance together — there is no
   * window where one is ahead of the other.
   *
   * The in-memory checkpoint AND the published cache advance ONLY after the
   * next checkpoint has been durably persisted (D5 — save-as-commit-marker).
   * A save failure keeps the old checkpoint + old cache; the next sample
   * re-reads the same events (idempotent builders by seq). On any failure the
   * previous cache is preserved so the dashboard never blanks.
   *
   * D5a atomic commit: build the new cache into a LOCAL first, then advance
   * checkpoint + cache on the same final step. A throw anywhere between the
   * save succeeding and the cache being assigned leaves BOTH old — so the
   * durable checkpoint and the published snapshot stay aligned. Without this
   * ordering, a throw from computeWorkflow/builder.snapshot after a successful
   * save would leave the durable checkpoint ahead of the published snapshot,
   * and the next sample would skip the window's events.
   *
   * Invalid-cursor discrimination (D12): a `readSince` throw of
   * `EventLogCursorError` (the beyond-head case) means the persisted
   * checkpoint's `seq` lies past the current log head. We reset BOTH builders
   * so a replay from `beginningCursor()` reconstructs each projection
   * independently — a truncated log could otherwise leave stale trace
   * lifecycles / timeline entries that never get reconciled out. The persisted
   * checkpoint file is left untouched; the next sample re-reads from the start
   * and overwrites it. Operational failures (disk read, save rejection) take
   * the existing path: preserve the current checkpoint + cache and retry next
   * sample.
   */
  private async sample(): Promise<void> {
    try {
      const batch = await this.eventLog.readSince(this.checkpoint.cursor);
      // Session filter FIRST — every projection is scoped to this collector's
      // session (D1/D3). The checkpoint cursor still advances over the FULL
      // batch (readSince returns all sessions' events; we must not re-read
      // them), while the builders only ever see this session's events.
      // Q-C4 — partition the freshly-read batch: session-matching events go to
      // the projections; every OTHER event (non-session-matching, not strictly
      // `sessionId === ""` — see partitionBySession) goes to the optional
      // relay. The relay receives ONLY this cycle's newly-read events — the
      // caller dedupes across cycles/restarts.
      const { session: sessionBatch, other } = partitionBySession(batch.events, this.sessionId);
      this.projectionRuntime.updateAll(sessionBatch);
      this.sessionlessEvents?.(other);

      const nextCheckpoint = { cursor: batch.cursor, committedAt: Date.now() };

      // Workflow accounting: append session-filtered events, then trim to the
      // last workflow.created boundary (computeWorkflow only needs events
      // since then).
      const nextRecentEvents = this.trimToActiveWorkflow([...this.recentEvents, ...sessionBatch]);

      // lastEventAt / totalEventCount are SESSION-SCOPED (D1/D3): a chat
      // collector's "last activity" must reflect its own session's events, not
      // an unrelated agent event sharing the same log.
      const sessionLast = sessionBatch[sessionBatch.length - 1];
      let nextTotalEventCount = this.totalEventCount;
      if (sessionLast) {
        // NOTE (D7 accounting): totalEventCount = highest seq seen, which
        // equals the event count because EventLog assigns contiguous seq from
        // 1 on append. This assumption holds for Phase 5; a future backend that
        // decouples seq from count must expose getEventCount() instead. Kept
        // SESSION-scoped: the watermark reflects this projection's events, not
        // the whole (cross-session) log.
        nextTotalEventCount = Math.max(nextTotalEventCount, sessionLast.seq ?? 0);
      }
      const nextCache: RuntimeSnapshot = {
        trace: this.projectionRuntime.snapshotOf<readonly ExecutionTraceEntry[]>(ProjectionIds.trace) ?? [],
        timeline: this.projectionRuntime.snapshotOf<readonly TimelineEntry[]>(ProjectionIds.timeline) ?? [],
        capabilities: this.projectionRuntime.snapshotOf<CapabilityProjectionSnapshot>(ProjectionIds.capability) ?? null,
        metrics: this.projectionRuntime.snapshotOf<MetricsProjectionSnapshot>(ProjectionIds.metrics) ?? null,
        context: this.projectionRuntime.snapshotOf<ContextProjectionSnapshot>(ProjectionIds.context) ?? null,
        evolution: (await this.projectionRuntime.snapshotOfAsync<EvolutionProjectionSnapshot>(ProjectionIds.evolution)) ?? null,
        workflow: computeWorkflow(nextRecentEvents),
        totalEventCount: nextTotalEventCount,
        lastEventAt: sessionLast ? Date.parse(sessionLast.timestamp) || Date.now() : this.cache.lastEventAt,
        sessionId: this.sessionId,
      };

      // D5/D5a commit — ORDER IS LOAD-BEARING.
      //   1. Build both projections into nextCache (above).
      //   2. Persist the checkpoint (durable) — below.
      //   3. Publish the snapshot: advance this.checkpoint + this.cache TOGETHER
      //      (final step, after the save).
      // `cache` is an IN-MEMORY PUBLICATION ARTIFACT, not durable state. The
      // durable checkpoint may only advance AFTER the projection state required
      // to reconstruct it has been built AND persisted (save-before-publish).
      // A crash between the checkpoint advance and the cache publish would
      // leave the durable watermark ahead of the published projection — the
      // invariant "a checkpoint never represents a projection state that has
      // not been durably published" must hold. Publish the snapshot and
      // advance the checkpoint TOGETHER (last step, after the save).
      // Phase 6.5/7: persist every registered projection's durable state in the
      // SAME atomic save transaction as the cursor (save-before-publish applies
      // to state too — a published snapshot never represents state that was not
      // durably saved). exportState() covers exactly the registered set.
      await this.checkpointStore.save({
        version: CHECKPOINT_CONTAINER_VERSION,
        cursor: this.eventLog.serializeCursor(nextCheckpoint.cursor),
        committedAt: nextCheckpoint.committedAt,
        projections: this.projectionRuntime.exportState(),
      });

      // ATOMIC commit: checkpoint + cache advance together on the same step
      // (D5a — a checkpoint file never represents a projection state that has
      // not been durably published; a published snapshot never represents a
      // checkpoint position that has not been durably persisted). If anything
      // above threw, this line never executes and the catch preserves BOTH old.
      this.checkpoint = nextCheckpoint;
      this.recentEvents = nextRecentEvents;
      this.totalEventCount = nextTotalEventCount;
      this.cache = nextCache;
    } catch (err) {
      if (err instanceof EventLogCursorError) {
        // D12 — beyond-head / invalid cursor. Reset ALL projections so the
        // replay from beginningCursor() reconstructs each projection
        // independently (no stale state carried across the reset). Cache stays
        // as-is for THIS sample; the next sample publishes the rebuilt
        // snapshot.
        this.projectionRuntime.resetAll();
        this.resetCheckpoint();
        return;
      }
      // Operational failure (read rejection, builder throw, save rejection) —
      // keep the previous cache + checkpoint so the dashboard never blanks;
      // checkpoint only advances after a durable save.
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

/** Q-C4 — partition a freshly-read batch into session-matching events
 *  (delivered to the projections) and EVERYTHING ELSE (`other` — every event
 *  whose `sessionId` does not match, i.e. what the session filter would
 *  otherwise drop). The `other` bucket is NOT strictly `sessionId === ""`: it
 *  also carries other sessions' events. That over-delivery is the recorded
 *  Q-C4 deviation (the relayed half is handed to the optional
 *  `sessionlessEvents` callback so session-less governance / measurement
 *  events can feed the evolution projection; the consumer type-filters
 *  defensively). */
export function partitionBySession(
  events: readonly AlixEvent[],
  sessionId: string,
): { readonly session: AlixEvent[]; readonly other: AlixEvent[] } {
  const session: AlixEvent[] = [];
  const other: AlixEvent[] = [];
  for (const e of events) {
    (e.sessionId === sessionId ? session : other).push(e);
  }
  return { session, other };
}
