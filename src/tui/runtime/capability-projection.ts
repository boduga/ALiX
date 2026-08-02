import type { AlixEvent } from '../../events/types.js';
import { TOOL_EVENT_TYPES, type ToolCompletedPayload, type ToolFailedPayload } from '../../events/types.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ProjectionState } from './projection-state.js';

export interface CapabilityStat {
  readonly capabilityId: string;
  readonly invocationCount: number;
  readonly invocationSucceeded: number;
  readonly invocationFailed: number;
  readonly invocationCancelled: number;
  readonly invocationTotalDurationMs: number;
  readonly lastInvocationAt: number | null;
  readonly toolInvocationCount: number;
  readonly toolFailureCount: number;
  readonly toolDurationMs: number;
}

export interface CapabilityProjectionSnapshot {
  readonly capabilities: Readonly<Record<string, CapabilityStat>>;
  readonly activeInvocations: number;
}

/** Mutable internal stat shape — the public CapabilityStat is readonly; the
 *  builder mutates counters through this writable view and only ever hands
 *  out (spread) copies of the readonly shape. */
type MutableStat = { -readonly [K in keyof CapabilityStat]: CapabilityStat[K] };

/** Strict timestamp parse — malformed timestamps break deterministic replay. */
function parseAt(e: AlixEvent, fallbackField: 'at' | 'timestamp'): number {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const raw = fallbackField === 'at' ? p.at : e.timestamp;
  const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
  if (!Number.isFinite(t)) throw new Error(`capability projection: invalid timestamp on seq ${e.seq}`);
  return t;
}

/** Single source of truth for invocation-terminal dispositions. A terminal
 *  type missing from this map is NOT an invocation terminal — the dispatch is
 *  explicit, never a silent catch-all (a 4th type added to the map without a
 *  disposition would be a no-op, never mis-counted as cancelled). Mirrors
 *  STATUS_BY_TYPE in execution-trace-builder. */
const TERMINAL_STATUS: Record<string, 'succeeded' | 'failed' | 'cancelled'> = {
  'capability.InvocationCompleted': 'succeeded',
  'capability.InvocationFailed': 'failed',
  'capability.InvocationCancelled': 'cancelled',
};

function zeroStat(capabilityId: string): MutableStat {
  return {
    capabilityId,
    invocationCount: 0, invocationSucceeded: 0, invocationFailed: 0, invocationCancelled: 0,
    invocationTotalDurationMs: 0, lastInvocationAt: null,
    toolInvocationCount: 0, toolFailureCount: 0, toolDurationMs: 0,
  };
}

interface InvocationLifecycle {
  readonly invocationId: string;
  readonly capabilityId: string;
  readonly startedAt: number;
}

/**
 * Lifecycle-reconciliation projection over capability invocations (primary)
 * + tool telemetry (complementary, never merged). Two independent streams:
 *   - Invocation lifecycle: capability.InvocationStarted/Completed/Failed/Cancelled.
 *   - Tool telemetry: tool.completed/failed (canonicalCapability) — a
 *     tool.requested alone records no usage, so a capability whose request
 *     never resolves leaves no phantom zero-stat entry.
 * Strictly single-pass: a terminal without its Started is a no-op; a Started
 * arriving after its terminal does NOT retroactively reconstruct — the
 * invocation is terminalized (closedInvocations) and neither a late Start nor
 * a NEW-seq duplicate terminal can re-open or re-count it. Unknown
 * capabilities appear (history outlives the registry). Never queries the
 * CapabilityRegistry — independent read model sharing only capabilityId.
 * Deterministic replay: no Date.now(); strict timestamp parse; the lastSeq
 * monotonic guard SKIPS already-applied seqs — idempotent against the
 * collector's at-least-once re-read path (a throw here would roll back
 * updateAll and stall every projection's checkpoint permanently).
 */
export class CapabilityProjection implements DurableProjectionBuilder<CapabilityProjectionSnapshot> {
  private readonly stats = new Map<string, MutableStat>();
  private readonly open = new Map<string, InvocationLifecycle>();   // key: invocationId
  /** InvocationIds that have been terminalized. Once closed, an invocation is
   *  permanently closed: a late Started is a no-op (spec decision #3) and a
   *  NEW-seq duplicate terminal never re-counts (mirrors the trace builder's
   *  closedByKey dedup). Part of the durable state. */
  private readonly closedInvocations = new Set<string>();
  private lastSeq = 0;

  update(events: readonly AlixEvent[]): void {
    for (const e of events) {
      // Idempotent against at-least-once replays: on the collector's
      // save-failure path the next sample re-reads the same events, so an
      // already-applied seq is SKIPPED, never re-counted and never thrown on
      // (the platform contract: "idempotent builders by seq"). A monotonic
      // guard still rejects nothing — ordering is guaranteed by the collector
      // (readSince batches) and the EventLog's contiguous-seq contract.
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;

      if (e.type === 'capability.InvocationStarted') {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const invocationId = typeof p.invocationId === 'string' ? p.invocationId : undefined;
        const capabilityId = typeof p.capabilityId === 'string' ? p.capabilityId : undefined;
        if (!invocationId || !capabilityId) continue;
        // A Started arriving after its terminal does NOT reconstruct — never
        // re-open a terminalized invocation (spec key decision #3).
        if (this.closedInvocations.has(invocationId)) continue;
        this.open.set(invocationId, { invocationId, capabilityId, startedAt: parseAt(e, 'at') });
        continue;
      }

      const disposition = TERMINAL_STATUS[e.type];
      if (disposition) {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const invocationId = typeof p.invocationId === 'string' ? p.invocationId : undefined;
        if (!invocationId) continue;
        const open = this.open.get(invocationId);
        if (open) {
          const endedAt = parseAt(e, 'at');
          const stat = this.touch(open.capabilityId);
          stat.invocationCount++;
          if (disposition === 'succeeded') stat.invocationSucceeded++;
          else if (disposition === 'failed') stat.invocationFailed++;
          else stat.invocationCancelled++;
          stat.invocationTotalDurationMs += Math.max(0, endedAt - open.startedAt);
          stat.lastInvocationAt = Math.max(stat.lastInvocationAt ?? 0, endedAt);
          this.open.delete(invocationId);
        }
        // Terminalize the invocation REGARDLESS of whether a Started was seen.
        // A terminal marks its invocation closed even when it never saw an open
        // lifecycle (spec decision #3: a late Started must not reconstruct),
        // and re-counting is impossible for a NEW-seq duplicate terminal. When
        // no open lifecycle existed the terminal is still a stats no-op — no
        // synthetic duration, no fabricated invocationCount.
        this.closedInvocations.add(invocationId);
        continue;
      }

      if (e.type === TOOL_EVENT_TYPES.REQUESTED || e.type === TOOL_EVENT_TYPES.COMPLETED || e.type === TOOL_EVENT_TYPES.FAILED) {
        // Tool telemetry (complementary stream — never merged with the
        // invocation counters). Only completed/failed represent measured
        // usage; a requested that never resolves contributes nothing.
        if (e.type === TOOL_EVENT_TYPES.REQUESTED) continue;
        const p = (e.payload ?? {}) as Partial<ToolCompletedPayload & ToolFailedPayload>;
        const cap = p.canonicalCapability;
        if (typeof cap !== 'string') continue;
        const stat = this.touch(cap);
        stat.toolInvocationCount++;
        if (e.type === TOOL_EVENT_TYPES.FAILED) stat.toolFailureCount++;
        if (typeof p.durationMs === 'number') stat.toolDurationMs += p.durationMs;
        continue;
      }
    }
  }

  snapshot(): CapabilityProjectionSnapshot {
    const capabilities: Record<string, CapabilityStat> = Object.create(null);
    for (const [id, stat] of this.stats) capabilities[id] = { ...stat };
    return { capabilities, activeInvocations: this.open.size };
  }

  reset(): void {
    this.stats.clear();
    this.open.clear();
    this.closedInvocations.clear();
    this.lastSeq = 0;
  }

  exportState(): ProjectionState {
    return {
      version: 1,
      stats: [...this.stats.entries()].map(([id, s]) => ({ id, stat: { ...s } })),
      open: [...this.open.entries()].map(([id, lc]) => ({ id, lifecycle: { ...lc } })),
      closedInvocations: [...this.closedInvocations],
      lastSeq: this.lastSeq,
    };
  }

  importState(state: ProjectionState): void {
    const s = state as { version?: unknown; stats?: unknown; open?: unknown; closedInvocations?: unknown; lastSeq?: unknown };
    if (s?.version !== 1 || !Array.isArray(s.stats) || !Array.isArray(s.open) || !Array.isArray(s.closedInvocations) || typeof s.lastSeq !== 'number') {
      throw new Error('capability projection state: invalid or unsupported version');
    }
    // Validate BEFORE mutating — malformed persisted state (e.g. a counter
    // field that is not a finite number) must throw cleanly, never silently
    // corrupt runtime counters. Checked via isFinite so NaN/Infinity/strings/
    // undefined are all rejected (checkpoints live forever; a corrupt file is
    // possible). startedAt gets the same isFinite rigor as the counters.
    for (const { id, stat } of s.stats as Array<{ id: unknown; stat: unknown }>) {
      if (typeof id !== 'string' || typeof stat !== 'object' || stat === null) throw new Error('capability projection state: malformed stat');
      const st = stat as Partial<CapabilityStat>;
      if (
        typeof st.invocationCount !== 'number' || !Number.isFinite(st.invocationCount) ||
        typeof st.invocationSucceeded !== 'number' || !Number.isFinite(st.invocationSucceeded) ||
        typeof st.invocationFailed !== 'number' || !Number.isFinite(st.invocationFailed) ||
        typeof st.invocationCancelled !== 'number' || !Number.isFinite(st.invocationCancelled) ||
        typeof st.invocationTotalDurationMs !== 'number' || !Number.isFinite(st.invocationTotalDurationMs) ||
        typeof st.toolInvocationCount !== 'number' || !Number.isFinite(st.toolInvocationCount) ||
        typeof st.toolFailureCount !== 'number' || !Number.isFinite(st.toolFailureCount) ||
        typeof st.toolDurationMs !== 'number' || !Number.isFinite(st.toolDurationMs)
      ) {
        throw new Error('capability projection state: malformed stat');
      }
    }
    for (const { id, lifecycle } of s.open as Array<{ id: unknown; lifecycle: unknown }>) {
      const lc = lifecycle as Partial<InvocationLifecycle>;
      if (
        typeof id !== 'string' || typeof lc !== 'object' || lc === null ||
        typeof lc.capabilityId !== 'string' ||
        typeof lc.startedAt !== 'number' || !Number.isFinite(lc.startedAt)
      ) {
        throw new Error('capability projection state: malformed open lifecycle');
      }
    }
    for (const id of s.closedInvocations as unknown[]) {
      if (typeof id !== 'string') throw new Error('capability projection state: malformed closedInvocations entry');
    }
    this.stats.clear();
    this.open.clear();
    this.closedInvocations.clear();
    for (const { id, stat } of s.stats as Array<{ id: string; stat: CapabilityStat }>) this.stats.set(id, { ...stat });
    for (const { id, lifecycle } of s.open as Array<{ id: string; lifecycle: InvocationLifecycle }>) this.open.set(id, { ...lifecycle });
    for (const id of s.closedInvocations as string[]) this.closedInvocations.add(id);
    this.lastSeq = s.lastSeq;
  }

  private touch(capabilityId: string): MutableStat {
    let stat = this.stats.get(capabilityId);
    if (!stat) { stat = zeroStat(capabilityId); this.stats.set(capabilityId, stat); }
    return stat;
  }
}
