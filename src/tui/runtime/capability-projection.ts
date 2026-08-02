import type { AlixEvent } from '../../events/types.js';
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

const INVOCATION_TERMINAL = new Set(['capability.InvocationCompleted', 'capability.InvocationFailed', 'capability.InvocationCancelled']);

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
 *   - Tool telemetry: tool.requested/completed/failed (canonicalCapability).
 * Strictly single-pass: a terminal without its Started is a no-op; a late
 * Started after its terminal does NOT retroactively reconstruct. Unknown
 * capabilities appear (history outlives the registry). Never queries the
 * CapabilityRegistry — independent read model sharing only capabilityId.
 * Deterministic replay: no Date.now(); strict timestamp parse; lastSeq guard.
 */
export class CapabilityProjection implements DurableProjectionBuilder<CapabilityProjectionSnapshot> {
  private readonly stats = new Map<string, MutableStat>();
  private readonly open = new Map<string, InvocationLifecycle>();   // key: invocationId
  private lastSeq = 0;

  update(events: readonly AlixEvent[]): void {
    for (const e of events) {
      if (e.seq <= this.lastSeq) throw new Error(`capability projection: non-monotonic event sequence (${e.seq} <= ${this.lastSeq})`);
      this.lastSeq = e.seq;
      if (e.type === 'capability.InvocationStarted') {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const invocationId = typeof p.invocationId === 'string' ? p.invocationId : undefined;
        const capabilityId = typeof p.capabilityId === 'string' ? p.capabilityId : undefined;
        if (!invocationId || !capabilityId) continue;
        this.open.set(invocationId, { invocationId, capabilityId, startedAt: parseAt(e, 'at') });
        continue;
      }
      if (INVOCATION_TERMINAL.has(e.type)) {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const invocationId = typeof p.invocationId === 'string' ? p.invocationId : undefined;
        if (!invocationId) continue;
        const open = this.open.get(invocationId);
        if (!open) continue;   // terminal without start → no-op
        const endedAt = parseAt(e, 'at');
        const stat = this.touch(open.capabilityId);
        stat.invocationCount++;
        if (e.type === 'capability.InvocationCompleted') stat.invocationSucceeded++;
        else if (e.type === 'capability.InvocationFailed') stat.invocationFailed++;
        else stat.invocationCancelled++;
        stat.invocationTotalDurationMs += Math.max(0, endedAt - open.startedAt);
        stat.lastInvocationAt = Math.max(stat.lastInvocationAt ?? 0, endedAt);
        this.open.delete(invocationId);
        continue;
      }
      if (e.type === 'tool.requested' || e.type === 'tool.completed' || e.type === 'tool.failed') {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const cap = typeof p.canonicalCapability === 'string' ? p.canonicalCapability : undefined;
        if (!cap) continue;
        const stat = this.touch(cap);
        if (e.type === 'tool.completed' || e.type === 'tool.failed') {
          stat.toolInvocationCount++;
          if (e.type === 'tool.failed') stat.toolFailureCount++;
          const dur = p.durationMs;
          if (typeof dur === 'number') stat.toolDurationMs += dur;
        }
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
    this.lastSeq = 0;
  }

  exportState(): ProjectionState {
    return {
      version: 1,
      stats: [...this.stats.entries()].map(([id, s]) => ({ id, stat: { ...s } })),
      open: [...this.open.entries()].map(([id, lc]) => ({ id, lifecycle: { ...lc } })),
      lastSeq: this.lastSeq,
    };
  }

  importState(state: ProjectionState): void {
    const s = state as { version?: unknown; stats?: unknown; open?: unknown; lastSeq?: unknown };
    if (s?.version !== 1 || !Array.isArray(s.stats) || !Array.isArray(s.open) || typeof s.lastSeq !== 'number') {
      throw new Error('capability projection state: invalid or unsupported version');
    }
    // Validate BEFORE mutating — a malformed stat (e.g. a counter field that
    // is not a finite number) must throw cleanly, never silently corrupt the
    // runtime counters. Checked via isFinite so NaN/Infinity/strings/undefined
    // are all rejected (checkpoints live forever; a corrupt file is possible).
    for (const { id, stat } of s.stats as Array<{ id: unknown; stat: unknown }>) {
      if (typeof id !== 'string' || typeof stat !== 'object' || stat === null) throw new Error('capability projection state: malformed stat');
      const st = stat as Partial<CapabilityStat>;
      if (
        typeof st.invocationCount !== 'number' || !Number.isFinite(st.invocationCount) ||
        typeof st.invocationSucceeded !== 'number' || !Number.isFinite(st.invocationSucceeded) ||
        typeof st.invocationFailed !== 'number' || !Number.isFinite(st.invocationFailed) ||
        typeof st.invocationCancelled !== 'number' || !Number.isFinite(st.invocationCancelled) ||
        typeof st.invocationTotalDurationMs !== 'number' || !Number.isFinite(st.invocationTotalDurationMs) ||
        (st.lastInvocationAt !== null && (typeof st.lastInvocationAt !== 'number' || !Number.isFinite(st.lastInvocationAt))) ||
        typeof st.toolInvocationCount !== 'number' || !Number.isFinite(st.toolInvocationCount) ||
        typeof st.toolFailureCount !== 'number' || !Number.isFinite(st.toolFailureCount) ||
        typeof st.toolDurationMs !== 'number' || !Number.isFinite(st.toolDurationMs)
      ) {
        throw new Error('capability projection state: malformed stat');
      }
    }
    for (const { id, lifecycle } of s.open as Array<{ id: unknown; lifecycle: unknown }>) {
      const lc = lifecycle as Partial<InvocationLifecycle>;
      if (typeof id !== 'string' || typeof lc !== 'object' || lc === null || typeof lc.capabilityId !== 'string' || typeof lc.startedAt !== 'number') {
        throw new Error('capability projection state: malformed open lifecycle');
      }
    }
    this.stats.clear();
    this.open.clear();
    for (const { id, stat } of s.stats as Array<{ id: string; stat: CapabilityStat }>) this.stats.set(id, { ...stat });
    for (const { id, lifecycle } of s.open as Array<{ id: string; lifecycle: InvocationLifecycle }>) this.open.set(id, { ...lifecycle });
    this.lastSeq = s.lastSeq;
  }

  private touch(capabilityId: string): MutableStat {
    let stat = this.stats.get(capabilityId);
    if (!stat) { stat = zeroStat(capabilityId); this.stats.set(capabilityId, stat); }
    return stat;
  }
}
