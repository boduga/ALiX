import type { AlixEvent } from '../../events/types.js';
import { TOOL_EVENT_TYPES } from '../../events/types.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ExecutionTraceEntry, ExecutionTraceKind, ExecutionTraceRetention } from './execution-trace.js';

// Trace entry ids are derived from the source event's firstSequence — no hidden
// module-global mutable state, deterministic and replay-safe within a runtime.
function traceIdFor(firstSequence: number): string { return `tr-${firstSequence}`; }

const TOOL_TYPES: Set<string> = new Set([
  TOOL_EVENT_TYPES.REQUESTED, TOOL_EVENT_TYPES.STARTED, TOOL_EVENT_TYPES.OUTPUT,
  TOOL_EVENT_TYPES.COMPLETED, TOOL_EVENT_TYPES.FAILED,
]);
const POLICY_TYPES = new Set(['policy.decision', 'approval.requested', 'approval.resolved', 'patch.checkpoint_created', 'patch.rollback_started', 'patch.rollback_completed', 'patch.rollback_failed']);
const CAPABILITY_TYPES = new Set(['capability.InvocationStarted', 'capability.InvocationProgress', 'capability.InvocationOutput', 'capability.InvocationCompleted', 'capability.InvocationFailed', 'capability.InvocationCancelled']);
const RUNTIME_TYPES = new Set(['runtime.phase.started', 'runtime.phase.completed', 'agent.session.phase_changed', 'workflow.created', 'workflow.completed']);

// Terminal event types terminate an open lifecycle. NOTE: capability bridge
// events are PascalCase after the dot (capability.InvocationCompleted), so
// string-suffix matching must not assume lowercase.
// patch.checkpoint_created is a standalone one-shot (it has no rollback pair) —
// marking it terminal means it never opens a running entry.
const TERMINAL_TYPES: Set<string> = new Set([
  TOOL_EVENT_TYPES.COMPLETED, TOOL_EVENT_TYPES.FAILED,
  'policy.decision', 'approval.resolved', 'patch.checkpoint_created', 'patch.rollback_completed', 'patch.rollback_failed',
  'capability.InvocationCompleted', 'capability.InvocationFailed', 'capability.InvocationCancelled',
  'runtime.phase.completed', 'workflow.completed',
]);

const STATUS_BY_TYPE: Record<string, ExecutionTraceEntry['status']> = {
  [TOOL_EVENT_TYPES.FAILED]: 'failed',
  'capability.InvocationFailed': 'failed',
  'capability.InvocationCancelled': 'cancelled',
  'policy.decision': 'completed',
  'approval.resolved': 'completed',
  'patch.checkpoint_created': 'completed',
  'patch.rollback_completed': 'completed',
  'patch.rollback_failed': 'failed',
  [TOOL_EVENT_TYPES.COMPLETED]: 'completed',
  'capability.InvocationCompleted': 'completed',
  'runtime.phase.completed': 'completed',
  'workflow.completed': 'completed',
};

/** Internal mutable projection state. `readonly` here only prevents
 *  reassignment of the fields, NOT mutation of the Map/Set contents — this
 *  object is intentionally mutable. Never expose references returned from it. */
export interface ExecutionTraceState {
  readonly seenSequences: Set<number>;
  readonly openByKey: Map<string, MutableLifecycle>;
  readonly terminalById: Map<string, ExecutionTraceEntry>;
  /** Lifecycle ids (`tr-${firstSequence}`) that have been terminalized. The
   *  open entry is deleted on close, so a NEW-seq duplicate terminal for the
   *  same key cannot reconstruct `tr-${firstSequence}` from the open map —
   *  `closedByKey` correlates the duplicate back to its closed lifecycle. */
  readonly closedFirstSequences: Set<string>;
  readonly closedByKey: Map<string, string>;
}

export interface MutableLifecycle {
  kind: ExecutionTraceKind;
  key: string;              // toolCallId / invocationId / timingId / workflowId / phase / approvalId / checkpointId
  title: string;
  /** Streamed detail parts accumulated from intermediate events (e.g. each
   *  tool.output stdout preview appends here). Joined with "\n" at
   *  materialization — long-running tool traces accumulate, not overwrite. */
  detailParts: string[];
  startedAt: number;
  firstSequence: number;
  lastSequence: number;
}

function kindOf(type: string): ExecutionTraceKind | null {
  if (TOOL_TYPES.has(type)) return 'tool';
  if (POLICY_TYPES.has(type)) return 'policy';
  if (CAPABILITY_TYPES.has(type)) return 'capability';
  if (RUNTIME_TYPES.has(type)) return 'runtime';
  return null;
}

/** Extract a stable grouping key for an event of a given kind. Falls back to
 *  `type:seq` so independent lifecycle starts with missing IDs never collapse
 *  onto one key. NOTE: `capabilityId` is deliberately NOT a grouping key — it
 *  names the capability (e.g. 'core.session.list'), not a specific invocation,
 *  so grouping by it would collapse two distinct invocations of the same
 *  capability. Only `invocationId` correlates a capability lifecycle. */
function keyOf(type: string, payload: Record<string, unknown>, seq: number): string {
  if (type.startsWith('capability.')) return String(payload.invocationId ?? `${type}:${seq}`);
  if (type.startsWith('tool.')) return String(payload.toolCallId ?? `${type}:${seq}`);
  if (type.startsWith('runtime.phase')) return String(payload.timingId ?? payload.operation ?? payload.phase ?? `${type}:${seq}`);
  if (type === 'agent.session.phase_changed') return String(payload.phase ?? payload.to ?? `${type}:${seq}`);
  if (type === 'workflow.created' || type === 'workflow.completed') return String(payload.workflowId ?? 'workflow');
  // policy.decision is a standalone terminal event — each decision is its own
  // lifecycle unit unless an explicit correlation ID ties it to an open approval.
  if (type === 'policy.decision') return `policy:${seq}`;
  // approval.requested + approval.resolved share approvalId — correlate them so
  // a pending approval closes into one lifecycle (not a permanent running row).
  if (type === 'approval.requested' || type === 'approval.resolved') return String(payload.approvalId ?? `${type}:${seq}`);
  // patch rollback started/completed/failed share checkpointId (+ toolCallId).
  if (type.startsWith('patch.')) return String(payload.checkpointId ?? payload.toolCallId ?? `${type}:${seq}`);
  return String(payload.proposalId ?? payload.rule ?? `${type}:${seq}`);
}

/** Build a one-line title for a lifecycle unit from its first (open) event. */
function titleOf(kind: ExecutionTraceKind, type: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'tool': return `tool.${payload.toolName ?? payload.toolCallId ?? '?'}`;
    case 'capability': return String(payload.capabilityId ?? payload.invocationId ?? '?');
    case 'policy':
      // Render the verdict (PolicyDecisionPayload.decision) when present.
      if (type === 'policy.decision') {
        return typeof payload.decision === 'string' ? `Policy: ${payload.decision}` : 'Policy decision';
      }
      return 'Approval';
    case 'runtime': return String(payload.operation ?? payload.phase ?? payload.workflowId ?? payload.timingId ?? 'phase');
  }
}

/** Resolve the one-line detail for a lifecycle unit. Terminal payload detail
 *  wins (error > outputPreview > phase > reason); the carried intermediate
 *  detail (e.g. tool stdout carried from tool.output) is the fallback when the
 *  terminal payload carries none. */
function resolveDetail(payload: Record<string, unknown>, carried?: string): string | undefined {
  const terminal =
    typeof payload.error === 'string' ? payload.error
      : typeof payload.outputPreview === 'string' ? payload.outputPreview
        : typeof payload.phase === 'string' ? payload.phase
          : typeof payload.reason === 'string' ? payload.reason : undefined;
  return terminal ?? carried;
}

export function createTraceState(): ExecutionTraceState {
  return {
    seenSequences: new Set(), openByKey: new Map(), terminalById: new Map(),
    closedFirstSequences: new Set(), closedByKey: new Map(),
  };
}

/** Reconcile new events into the projection state. Idempotent by event seq:
 *  an event whose seq is already seen is skipped. Terminal lifecycles are
 *  first-write-wins — a later terminal for the same lifecycle does not rewrite
 *  the stored entry (its seq is still marked seen). A NEW-seq duplicate
 *  terminal (same key, open entry already deleted on close) is correlated back
 *  to its closed lifecycle via `closedByKey` and ignored. */
export function reconcileEvents(state: ExecutionTraceState, events: readonly AlixEvent[]): void {
  for (const e of events) {
    const seqNum = e.seq ?? 0;
    if (state.seenSequences.has(seqNum)) continue;
    state.seenSequences.add(seqNum);

    const kind = kindOf(e.type);
    if (!kind) continue;
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const key = keyOf(e.type, payload, seqNum);
    const ts = Date.parse(e.timestamp) || 0;
    const isTerminal = TERMINAL_TYPES.has(e.type);

    if (!isTerminal) {
      const mapKey = `${kind}:${key}`;
      let o = state.openByKey.get(mapKey);
      if (!o) {
        o = { kind, key, title: titleOf(kind, e.type, payload), detailParts: [], startedAt: ts, firstSequence: seqNum, lastSequence: seqNum };
        state.openByKey.set(mapKey, o);
      } else {
        o.lastSequence = Math.max(o.lastSequence, seqNum);
      }
      // Accumulate streamed detail (each tool.output preview appends) — a
      // long-running tool trace builds up, it does not overwrite.
      if (e.type === TOOL_EVENT_TYPES.OUTPUT) {
        const preview = payload.outputPreview;
        if (typeof preview === 'string' && preview.length > 0) o.detailParts.push(preview);
      }
      continue;
    }

    const mapKey = `${kind}:${key}`;
    const o = state.openByKey.get(mapKey);
    const status: ExecutionTraceEntry['status'] = STATUS_BY_TYPE[e.type] ?? 'completed';
    // Resolve the lifecycle id: the open lifecycle's id, or — for a NEW-seq
    // duplicate whose open entry was deleted on an earlier close — the
    // previously-closed lifecycle's id via key correlation. Fall back to a
    // standalone synthesized id when the key was never opened.
    const id = o ? traceIdFor(o.firstSequence) : (state.closedByKey.get(mapKey) ?? traceIdFor(seqNum));

    // First-write-wins (D5): a terminal for a lifecycle already terminalized
    // is ignored. Tracked via closedFirstSequences because the open entry is
    // deleted on close — a NEW-seq duplicate terminal would otherwise resolve
    // `id = tr-<newSeq>` from the fallback and synthesize a second entry.
    // NOTE: the duplicate terminal's seq was already added to seenSequences at
    // the top of the loop — those seqs are retained for diagnostics (per D5),
    // so a future maintainer must NOT "fix" that by removing them.
    if (state.closedFirstSequences.has(id)) continue;

    if (o) {
      state.closedFirstSequences.add(id);
      state.closedByKey.set(mapKey, id);
      state.terminalById.set(id, {
        id, kind, status, title: o.title,
        detail: resolveDetail(payload, o.detailParts.join("\n")),
        startedAt: o.startedAt, completedAt: ts,
        durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : Math.max(0, ts - o.startedAt),
        sourceEvents: { firstSequence: o.firstSequence, lastSequence: Math.max(o.lastSequence, seqNum) },
      });
      state.openByKey.delete(mapKey);
    } else {
      // A terminal event without a recorded open — synthesize a completed entry.
      state.terminalById.set(id, {
        id, kind, status, title: titleOf(kind, e.type, payload),
        detail: resolveDetail(payload),
        startedAt: ts, completedAt: ts,
        durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : 0,
        sourceEvents: { firstSequence: seqNum, lastSequence: seqNum },
      });
    }
  }
}

/** Emit fresh immutable DTOs. Terminal entries oldest→newest by firstSequence,
 *  then open entries as running (oldest first, NO lastSequence). Never returns
 *  references into state maps. */
export function materializeTrace(state: ExecutionTraceState): ExecutionTraceEntry[] {
  const terminal = [...state.terminalById.values()]
    .sort((a, b) => a.sourceEvents.firstSequence - b.sourceEvents.firstSequence)
    .map(cloneEntry);
  const running = [...state.openByKey.values()]
    .sort((a, b) => a.firstSequence - b.firstSequence)
    .map(o => cloneEntry({
      id: traceIdFor(o.firstSequence), kind: o.kind, status: 'running', title: o.title,
      detail: o.detailParts.length > 0 ? o.detailParts.join("\n") : undefined,
      startedAt: o.startedAt,
      sourceEvents: { firstSequence: o.firstSequence },
    }));
  return [...terminal, ...running];
}

function cloneEntry(e: ExecutionTraceEntry): ExecutionTraceEntry {
  return {
    id: e.id, kind: e.kind, status: e.status, title: e.title,
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    startedAt: e.startedAt,
    ...(e.completedAt !== undefined ? { completedAt: e.completedAt } : {}),
    ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
    sourceEvents: {
      firstSequence: e.sourceEvents.firstSequence,
      ...(e.sourceEvents.lastSequence !== undefined ? { lastSequence: e.sourceEvents.lastSequence } : {}),
    },
  };
}

/**
 * Compatibility wrapper over the shared reconciliation engine. Deterministic
 * one-shot reconstruction (bootstrap/tests). The incremental builder uses the
 * SAME engine — no second grouping algorithm.
 */
export function buildExecutionTrace(events: readonly AlixEvent[]): ExecutionTraceEntry[] {
  const state = createTraceState();
  reconcileEvents(state, events);
  return materializeTrace(state);
}

/** Pure builder contract. `build` over the full history today; a future
 *  incremental `update(newEvents)` can be added without changing consumers. */
export interface ExecutionTraceBuilder {
  build(events: readonly AlixEvent[]): ExecutionTraceEntry[];
}

/** D9 surface: a named, stable entry point for future incremental updates.
 *  `buildExecutionTrace` remains the pure exported function (tests + retention
 *  use it); this factory is the forward-compatible builder contract. */
export function createExecutionTraceBuilder(): ExecutionTraceBuilder {
  return { build: buildExecutionTrace };
}

/** Phase 6.5 durable state: the raw reconciliation state (pre-retention). Maps
 *  and Sets are serialized as arrays of key/value pairs; importState rebuilds
 *  the Maps/Sets exactly. Declared as a type alias (not interface) so
 *  ExecutionTraceBuilderState is assignable to ProjectionState =
 *  Record<string, unknown> (interfaces lack an implicit index signature, so
 *  they fail strict assignability to Record<string, unknown> — same reason
 *  TimelineBuilderState is a type alias). */
export type ExecutionTraceBuilderState = {
  readonly version: 1;
  readonly seenSequences: number[];
  readonly openByKey: Array<{ key: string; lifecycle: MutableLifecycle }>;
  readonly terminalById: Array<{ id: string; entry: ExecutionTraceEntry }>;
  readonly closedFirstSequences: string[];
  readonly closedByKey: Array<{ key: string; id: string }>;
};

/** Structural validation for untrusted persisted state (rides the checkpoint
 *  envelope). Runs BEFORE importState mutates any Map/Set so a malformed element
 *  throws cleanly and leaves the builder in its prior (or empty) state — never
 *  half-imported. Mirrors TimelineBuilder.importState's per-entry validation
 *  (timeline-builder.ts). Validates the load-bearing fields: what
 *  update()/materializeTrace() read off the state (kind/title/detailParts/
 *  startedAt/firstSequence for lifecycles; sourceEvents.firstSequence for
 *  terminal entries). */
function assertTraceStateElements(
  seenSequences: readonly unknown[],
  openByKey: readonly unknown[],
  terminalById: readonly unknown[],
  closedFirstSequences: readonly unknown[],
  closedByKey: readonly unknown[],
): void {
  for (const seq of seenSequences) {
    if (typeof seq !== 'number') throw new Error('trace projection state: malformed seenSequences entry');
  }
  for (const el of openByKey) {
    if (el == null || typeof el !== 'object') throw new Error('trace projection state: malformed openByKey entry');
    const { key, lifecycle } = el as { key?: unknown; lifecycle?: unknown };
    if (typeof key !== 'string') throw new Error('trace projection state: malformed openByKey key');
    if (lifecycle == null || typeof lifecycle !== 'object') throw new Error('trace projection state: malformed lifecycle');
    const l = lifecycle as Record<string, unknown>;
    if (
      typeof l.kind !== 'string' ||
      typeof l.title !== 'string' ||
      !Array.isArray(l.detailParts) ||
      !l.detailParts.every((p) => typeof p === 'string') ||
      typeof l.startedAt !== 'number' ||
      typeof l.firstSequence !== 'number' ||
      typeof l.lastSequence !== 'number'
    ) {
      throw new Error('trace projection state: malformed lifecycle');
    }
  }
  for (const el of terminalById) {
    if (el == null || typeof el !== 'object') throw new Error('trace projection state: malformed terminalById entry');
    const { id, entry } = el as { id?: unknown; entry?: unknown };
    if (typeof id !== 'string') throw new Error('trace projection state: malformed terminalById id');
    if (entry == null || typeof entry !== 'object') throw new Error('trace projection state: malformed terminal entry');
    const en = entry as Record<string, unknown>;
    if (
      typeof en.id !== 'string' ||
      typeof en.kind !== 'string' ||
      typeof en.status !== 'string' ||
      typeof en.title !== 'string' ||
      typeof en.startedAt !== 'number' ||
      en.sourceEvents == null || typeof en.sourceEvents !== 'object' ||
      typeof (en.sourceEvents as Record<string, unknown>).firstSequence !== 'number'
    ) {
      throw new Error('trace projection state: malformed terminal entry');
    }
  }
  for (const id of closedFirstSequences) {
    if (typeof id !== 'string') throw new Error('trace projection state: malformed closedFirstSequences entry');
  }
  for (const el of closedByKey) {
    if (el == null || typeof el !== 'object') throw new Error('trace projection state: malformed closedByKey entry');
    const { key, id } = el as { key?: unknown; id?: unknown };
    if (typeof key !== 'string' || typeof id !== 'string') {
      throw new Error('trace projection state: malformed closedByKey entry');
    }
  }
}

/** Stateful facade over the shared reconciliation engine. Holds mutable
 *  projection state; publishes fresh immutable snapshots after retention.
 *  Idempotent by event seq — safe against cursor at-least-once replays. */
export class IncrementalExecutionTraceBuilder implements DurableProjectionBuilder<ExecutionTraceEntry> {
  private readonly state: ExecutionTraceState = createTraceState();
  private readonly retention: ExecutionTraceRetention;

  constructor(retention: ExecutionTraceRetention = createExecutionTraceRetention()) {
    this.retention = retention;
  }

  /** Reconcile new events into the lifecycle state. Idempotent by event seq. */
  update(events: readonly AlixEvent[]): void {
    reconcileEvents(this.state, events);
  }

  /** Fresh immutable snapshot after retention. Never mutates prior snapshots. */
  snapshot(): readonly ExecutionTraceEntry[] {
    return this.retention.apply(materializeTrace(this.state));
  }

  /** Wipe the in-memory projection state (D12). Called by the collector on a
   *  beyond-head / invalid-cursor fallback so a replay from `beginningCursor()`
   *  reconstructs the projection from scratch — a truncated log can otherwise
   *  leave stale lifecycles that never get reconciled out. */
  reset(): void {
    this.state.seenSequences.clear();
    this.state.openByKey.clear();
    this.state.terminalById.clear();
    this.state.closedFirstSequences.clear();
    this.state.closedByKey.clear();
  }

  exportState(): ExecutionTraceBuilderState {
    return {
      version: 1,
      seenSequences: [...this.state.seenSequences],
      openByKey: [...this.state.openByKey.entries()].map(([key, lifecycle]) => ({ key, lifecycle: { ...lifecycle, detailParts: [...lifecycle.detailParts] } })),
      terminalById: [...this.state.terminalById.entries()].map(([id, entry]) => ({ id, entry })),
      closedFirstSequences: [...this.state.closedFirstSequences],
      closedByKey: [...this.state.closedByKey.entries()].map(([key, id]) => ({ key, id })),
    };
  }

  importState(state: Record<string, unknown>): void {
    const s = state as Partial<ExecutionTraceBuilderState>;
    if (
      s?.version !== 1 ||
      !Array.isArray(s.seenSequences) ||
      !Array.isArray(s.openByKey) ||
      !Array.isArray(s.terminalById) ||
      !Array.isArray(s.closedFirstSequences) ||
      !Array.isArray(s.closedByKey)
    ) {
      throw new Error('trace projection state: invalid or unsupported version');
    }
    // Validate ALL elements BEFORE mutating — a malformed element must throw
    // cleanly and leave the builder in its prior (or empty) state, never
    // half-imported (clear() below wipes prior state). State is untrusted
    // persisted data riding the checkpoint envelope.
    assertTraceStateElements(s.seenSequences, s.openByKey, s.terminalById, s.closedFirstSequences, s.closedByKey);
    // ExecutionTraceState fields are `readonly` — the field only ever points at
    // the createTraceState() object (reassignment is a design invariant, per the
    // interface docstring). So import rebuilds each Map/Set in place, mirroring
    // reset()'s mutation pattern. detailParts is deep-copied on the way in so a
    // later importState can never alias the caller's array.
    this.state.seenSequences.clear();
    this.state.openByKey.clear();
    this.state.terminalById.clear();
    this.state.closedFirstSequences.clear();
    this.state.closedByKey.clear();
    for (const seq of s.seenSequences) this.state.seenSequences.add(seq);
    for (const { key, lifecycle } of s.openByKey) {
      this.state.openByKey.set(key, { ...lifecycle, detailParts: [...lifecycle.detailParts] });
    }
    for (const { id, entry } of s.terminalById) this.state.terminalById.set(id, entry);
    for (const id of s.closedFirstSequences) this.state.closedFirstSequences.add(id);
    for (const { key, id } of s.closedByKey) this.state.closedByKey.set(key, id);
  }
}

/** Retention policy: running never evicted; terminal sorted oldest→newest by
 *  startedAt then running appended; maxTerminal bound. */
export function createExecutionTraceRetention(maxTerminal = 50): ExecutionTraceRetention {
  return {
    apply(entries) {
      const terminal = entries.filter((e) => e.status !== 'running');
      const running = entries.filter((e) => e.status === 'running');
      const keptTerminal = [...terminal]
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(-Math.max(0, maxTerminal));
      return [...keptTerminal, ...running];
    },
  };
}

/** Compose builder + retention — the collector's entry point. */
export function computeExecutionTrace(
  events: readonly AlixEvent[],
  retention: ExecutionTraceRetention = createExecutionTraceRetention(),
): readonly ExecutionTraceEntry[] {
  return retention.apply(buildExecutionTrace(events));
}
